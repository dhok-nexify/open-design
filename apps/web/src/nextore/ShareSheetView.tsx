'use client';

import { useEffect, useState } from 'react';

import styles from './PublicSharePage.module.css';

const MAX_ROWS = 200;
const MAX_COLUMNS = 30;

type Cell = string | number | boolean | Date | null;
type SheetInfo = { name: string };

function cellText(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleDateString();
  return String(value);
}

/**
 * Spreadsheet preview: every sheet becomes a scrollable table.
 *
 * The workbook is parsed in the browser with read-excel-file (no server round
 * trip, no macro execution) and capped so a 50,000-row sheet cannot freeze the
 * tab. Only the values are shown — formulas render as their cached result.
 */
export function ShareSheetView({
  url,
  labels,
}: {
  url: string;
  labels: { loading: string; failed: string; sheet: string; truncated: string };
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [active, setActive] = useState('');
  const [rows, setRows] = useState<Cell[][]>([]);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('sheet_unavailable');
        const buffer = await response.arrayBuffer();
        const module = await import('read-excel-file');
        const names = await module.readSheetNames(buffer);
        if (cancelled) return;
        if (names.length === 0) throw new Error('sheet_empty');
        setSheets(names.map((name) => ({ name })));
        setActive(names[0]!);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const readXlsxFile = (await import('read-excel-file')).default;
        const all = await readXlsxFile(buffer, { sheet: active }) as Cell[][];
        if (cancelled) return;
        const cut = all.length > MAX_ROWS || (all[0]?.length ?? 0) > MAX_COLUMNS;
        setRows(all.slice(0, MAX_ROWS).map((row) => row.slice(0, MAX_COLUMNS)));
        setTruncated(cut);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, url]);

  if (state === 'loading') {
    return (
      <div className={styles.state} role="status" aria-live="polite">
        <p className={styles.stateBody}>{labels.loading}</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={styles.state} role="alert">
        <p className={styles.stateBody}>{labels.failed}</p>
      </div>
    );
  }

  const header = rows[0] ?? [];
  const body = rows.slice(1);

  return (
    <div className={styles.sheetPane}>
      <div className={styles.sheetTabs} role="tablist" aria-label={labels.sheet}>
        {sheets.map((sheet) => (
          <button
            key={sheet.name}
            type="button"
            role="tab"
            aria-selected={sheet.name === active}
            className={sheet.name === active ? styles.sheetTabActive : styles.sheetTab}
            onClick={() => setActive(sheet.name)}
          >
            {sheet.name}
          </button>
        ))}
      </div>
      <div className={styles.sheetTableWrap}>
        <table className={styles.sheetTable}>
          <thead>
            <tr>
              {header.map((cell, index) => (
                <th key={index}>{cellText(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {header.map((_, columnIndex) => (
                  <td key={columnIndex}>{cellText(row[columnIndex] ?? null)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated ? <p className={styles.sheetNotice}>{labels.truncated}</p> : null}
    </div>
  );
}
