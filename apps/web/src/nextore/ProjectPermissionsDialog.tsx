'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react';
import { Button, Dialog, Input } from '@open-design/components';
import type {
  NextorePermissionGroup,
  NextorePermissionMember,
  NextoreProjectPermissionItem,
  NextoreProjectPermissionRights,
  NextoreProjectPermissions,
  SaveNextoreProjectPermissionsRequest,
} from '@open-design/contracts';

import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import {
  applyPermissionDependencies,
  emptyPermissionRights,
  fetchPermissionGroups,
  fetchPermissionMembers,
  fetchProjectPermissions,
  permissionCellDisabled,
  saveProjectPermissions,
  type PermissionRightKey,
} from './project-permissions';
import styles from './ProjectPermissionsDialog.module.css';

type Translate = ReturnType<typeof useT>;

const COLUMNS: Array<{ key: PermissionRightKey; labelKey: Parameters<Translate>[0] }> = [
  { key: 'manage', labelKey: 'nextorePermissions.manage' },
  { key: 'read', labelKey: 'nextorePermissions.read' },
  { key: 'edit', labelKey: 'nextorePermissions.edit' },
  { key: 'delete', labelKey: 'nextorePermissions.delete' },
  { key: 'download', labelKey: 'nextorePermissions.download' },
  { key: 'checkOut', labelKey: 'nextorePermissions.lock' },
  { key: 'createFile', labelKey: 'nextorePermissions.createFile' },
  { key: 'createFolder', labelKey: 'nextorePermissions.createFolder' },
];

function PermissionTable({
  rows,
  readOnly,
  emptyLabel,
  caption,
  t,
  onToggle,
  onRemove,
}: {
  rows: NextoreProjectPermissionItem[];
  readOnly: boolean;
  emptyLabel: string;
  caption: string;
  t: Translate;
  onToggle?: (index: number, key: PermissionRightKey, checked: boolean) => void;
  onRemove?: (index: number) => void;
}) {
  if (rows.length === 0) {
    return <p className={styles.empty}>{emptyLabel}</p>;
  }
  return (
    <div className={styles.matrixWrap}>
      <table className={styles.matrix}>
        <caption className={styles.visuallyHidden}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t('nextorePermissions.groupMember')}</th>
            {COLUMNS.map((column) => (
              <th key={column.key} scope="col">{t(column.labelKey)}</th>
            ))}
            <th scope="col"><span className={styles.visuallyHidden}>{t('nextorePermissions.remove')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowReadOnly = readOnly || row.inherited || row.recordType === 'owner';
            return (
              <tr key={row.recordType + ':' + row.recordId}>
                <th scope="row">
                  <span className={styles.record}>
                    <span className={styles.recordIcon} aria-hidden>
                      <Icon name={row.recordType === 'group' ? 'users' : 'user'} size={13} />
                    </span>
                    <span className={styles.recordName}>{row.name || '#' + row.recordId}</span>
                    {row.recordType === 'owner' ? (
                      <span className={styles.badge}>{t('nextorePermissions.owner')}</span>
                    ) : null}
                    {row.inherited ? (
                      <span className={styles.badge}>{t('nextorePermissions.inherited')}</span>
                    ) : null}
                  </span>
                </th>
                {COLUMNS.map((column) => (
                  <td key={column.key} className={styles.checkCell}>
                    <input
                      type="checkbox"
                      checked={row.rights[column.key]}
                      disabled={rowReadOnly || permissionCellDisabled(row.rights, column.key)}
                      aria-label={t(column.labelKey) + ' — ' + (row.name || '#' + row.recordId)}
                      onChange={(event) => {
                        if (!onToggle || rowReadOnly) return;
                        onToggle(index, column.key, event.currentTarget.checked);
                      }}
                    />
                  </td>
                ))}
                <td className={styles.checkCell}>
                  {rowReadOnly || !onRemove ? null : (
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label={t('nextorePermissions.remove') + ' ' + (row.name || '#' + row.recordId)}
                      onClick={() => onRemove(index)}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface GroupNode extends NextorePermissionGroup {
  children: GroupNode[];
}

function buildGroupTree(groups: NextorePermissionGroup[]): GroupNode[] {
  const byId = new Map<number, GroupNode>();
  for (const group of groups) byId.set(group.id, { ...group, children: [] });
  const roots: GroupNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId > 0 ? byId.get(node.parentId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function GroupTreeNode({
  node,
  level,
  selected,
  onToggle,
  t,
}: {
  node: GroupNode;
  level: number;
  selected: Set<number>;
  onToggle: (group: NextorePermissionGroup) => void;
  t: Translate;
}) {
  const [expanded, setExpanded] = useState(level < 2);
  const hasChildren = node.children.length > 0;
  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-level={level + 1}
      aria-selected={selected.has(node.id)}
    >
      <div className={styles.treeRow}>
        {hasChildren ? (
          <button
            type="button"
            className={styles.disclosure}
            aria-label={(expanded ? t('nextorePermissions.collapse') : t('nextorePermissions.expand')) + ' ' + node.name}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
          </button>
        ) : (
          <span className={styles.disclosureSpacer} aria-hidden />
        )}
        <label className={styles.treeLabel}>
          <input
            type="checkbox"
            checked={selected.has(node.id)}
            onChange={() => onToggle(node)}
          />
          <span>{node.name || '#' + node.id}</span>
        </label>
      </div>
      {hasChildren && expanded ? (
        <ul role="group" className={styles.treeChildren}>
          {node.children.map((child) => (
            <GroupTreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selected={selected}
              onToggle={onToggle}
              t={t}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function GroupMemberPicker({
  projectId,
  open,
  onClose,
  onConfirm,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (groups: NextorePermissionGroup[], members: NextorePermissionMember[]) => void;
}) {
  const t = useT();
  const titleId = useId();
  const [groupQuery, setGroupQuery] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [groups, setGroups] = useState<NextorePermissionGroup[]>([]);
  const [members, setMembers] = useState<NextorePermissionMember[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Map<number, NextorePermissionGroup>>(new Map());
  const [selectedMembers, setSelectedMembers] = useState<Map<number, NextorePermissionMember>>(new Map());
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGroupQuery('');
    setMemberQuery('');
    setGroups([]);
    setMembers([]);
    setSelectedGroups(new Map());
    setSelectedMembers(new Map());
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setGroupsLoading(true);
      void fetchPermissionGroups(projectId, groupQuery)
        .then((result) => {
          if (!cancelled) setGroups(result.groups);
        })
        .catch(() => {
          if (!cancelled) setError(t('nextorePermissions.loadFailed'));
        })
        .finally(() => {
          if (!cancelled) setGroupsLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, projectId, groupQuery, t]);

  useEffect(() => {
    if (!open) return;
    if (!memberQuery.trim()) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setMembersLoading(true);
      void fetchPermissionMembers(projectId, memberQuery)
        .then((result) => {
          if (!cancelled) setMembers(result);
        })
        .catch(() => {
          if (!cancelled) setError(t('nextorePermissions.loadFailed'));
        })
        .finally(() => {
          if (!cancelled) setMembersLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, projectId, memberQuery, t]);

  const tree = useMemo(() => buildGroupTree(groups), [groups]);
  const selectedGroupIds = useMemo(
    () => new Set(selectedGroups.keys()),
    [selectedGroups],
  );

  function toggleGroup(group: NextorePermissionGroup): void {
    setSelectedGroups((current) => {
      const next = new Map(current);
      if (next.has(group.id)) next.delete(group.id);
      else next.set(group.id, group);
      return next;
    });
  }

  function toggleMember(member: NextorePermissionMember): void {
    setSelectedMembers((current) => {
      const next = new Map(current);
      if (next.has(member.id)) next.delete(member.id);
      else next.set(member.id, member);
      return next;
    });
  }

  function onTreeKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    if (items.length === 0) return;
    const activeItem = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[role="treeitem"]');
    const index = activeItem ? items.indexOf(activeItem) : -1;
    const next = event.key === 'ArrowDown' ? items[index + 1] : items[index - 1];
    if (!next) return;
    event.preventDefault();
    next.querySelector<HTMLElement>('button, input')?.focus();
  }

  const selectedCount = selectedGroups.size + selectedMembers.size;
  if (!open) return null;

  return (
    <Dialog
      className={styles.pickerDialog}
      ariaLabelledBy={titleId}
      onClose={onClose}
      closeOnBackdrop
      closeOnEscape
      data-testid="nextore-permission-picker"
    >
      <div className={styles.header}>
        <h2 id={titleId} className={styles.title}>{t('nextorePermissions.addTitle')}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <p className={styles.hint}>{t('nextorePermissions.selectHint')}</p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.pickerGrid}>
        <section className={styles.pickerColumn} aria-labelledby={titleId + '-groups'}>
          <h3 id={titleId + '-groups'} className={styles.sectionTitle}>{t('nextorePermissions.group')}</h3>
          <label className={styles.field}>
            <span className={styles.label}>{t('nextorePermissions.searchGroups')}</span>
            <Input
              type="search"
              value={groupQuery}
              placeholder={t('nextorePermissions.searchGroups')}
              onChange={(event) => setGroupQuery(event.currentTarget.value)}
            />
          </label>
          <div className={styles.treeBox}>
            {groupsLoading ? <p className={styles.hint}>{t('common.loading')}</p> : null}
            {!groupsLoading && tree.length === 0 ? (
              <p className={styles.empty}>{t('nextorePermissions.noGroups')}</p>
            ) : null}
            {tree.length > 0 ? (
              <ul className={styles.tree} role="tree" aria-label={t('nextorePermissions.group')} aria-multiselectable="true" onKeyDown={onTreeKeyDown}>
                {tree.map((node) => (
                  <GroupTreeNode
                    key={node.id}
                    node={node}
                    level={0}
                    selected={selectedGroupIds}
                    onToggle={toggleGroup}
                    t={t}
                  />
                ))}
              </ul>
            ) : null}
          </div>
        </section>
        <section className={styles.pickerColumn} aria-labelledby={titleId + '-members'}>
          <h3 id={titleId + '-members'} className={styles.sectionTitle}>{t('nextorePermissions.member')}</h3>
          <label className={styles.field}>
            <span className={styles.label}>{t('nextorePermissions.searchMembers')}</span>
            <Input
              type="search"
              value={memberQuery}
              placeholder={t('nextorePermissions.searchMembers')}
              onChange={(event) => setMemberQuery(event.currentTarget.value)}
            />
          </label>
          <div className={styles.memberBox}>
            {membersLoading ? <p className={styles.hint}>{t('common.loading')}</p> : null}
            {!membersLoading && !memberQuery.trim() ? (
              <p className={styles.empty}>{t('nextorePermissions.noMembers')}</p>
            ) : null}
            {!membersLoading && memberQuery.trim() && members.length === 0 ? (
              <p className={styles.empty}>{t('nextorePermissions.noMembers')}</p>
            ) : null}
            {members.length > 0 ? (
              <ul className={styles.memberList}>
                {members.map((member) => (
                  <li key={member.id}>
                    <label className={styles.memberRow}>
                      <input
                        type="checkbox"
                        checked={selectedMembers.has(member.id)}
                        onChange={() => toggleMember(member)}
                      />
                      <span className={styles.memberText}>
                        <span>{member.fullName || member.login || '#' + member.id}</span>
                        {member.email ? <small>{member.email}</small> : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      </div>
      <div className={styles.footer}>
        <span className={styles.count}>{selectedCount} {t('nextorePermissions.selected')}</span>
        <Button type="button" onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          type="button"
          variant="primary"
          disabled={selectedCount === 0}
          onClick={() => onConfirm(Array.from(selectedGroups.values()), Array.from(selectedMembers.values()))}
        >
          {t('nextorePermissions.confirmAdd')}
        </Button>
      </div>
    </Dialog>
  );
}

export function ProjectPermissionsDialog({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<NextoreProjectPermissions | null>(null);
  const [customRows, setCustomRows] = useState<NextoreProjectPermissionItem[]>([]);
  const [inheritedRows, setInheritedRows] = useState<NextoreProjectPermissionItem[]>([]);
  const [isInherit, setIsInherit] = useState(true);
  const [applyToChildren, setApplyToChildren] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchProjectPermissions(projectId);
      setSnapshot(next);
      setCustomRows(next.customized);
      setInheritedRows(next.inherited);
      setIsInherit(next.isInherit);
    } catch {
      setError(t('nextorePermissions.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    if (!open) return;
    setSaved(false);
    setPickerOpen(false);
    setApplyToChildren(false);
    void load();
  }, [open, load]);

  function toggleRow(index: number, key: PermissionRightKey, checked: boolean): void {
    setSaved(false);
    setCustomRows((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const rights = applyPermissionDependencies({ ...row.rights, [key]: checked });
      return { ...row, rights };
    }));
  }

  function removeRow(index: number): void {
    setSaved(false);
    setCustomRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  function addSelected(groups: NextorePermissionGroup[], members: NextorePermissionMember[]): void {
    setSaved(false);
    setCustomRows((current) => {
      const seen = new Set(current.map((row) => row.recordType + ':' + row.recordId));
      const next = [...current];
      const baseRights = (): NextoreProjectPermissionRights => applyPermissionDependencies({
        ...emptyPermissionRights(),
        read: true,
      });
      for (const group of groups) {
        const key = 'group:' + group.id;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({
          recordId: group.id,
          recordType: 'group',
          name: group.name,
          inherited: false,
          rights: baseRights(),
        });
      }
      for (const member of members) {
        const key = 'member:' + member.id;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({
          recordId: member.id,
          recordType: 'member',
          name: member.fullName || member.login || '#' + member.id,
          inherited: false,
          rights: baseRights(),
        });
      }
      return next;
    });
    setPickerOpen(false);
  }

  const hasManager = customRows.some((row) => row.rights.manage);
  const canEdit = snapshot?.canManage === true;

  async function save(): Promise<void> {
    if (!canEdit || !hasManager || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const body: SaveNextoreProjectPermissionsRequest = {
      isInherit,
      applyToAllChildren: applyToChildren,
      items: customRows.map((row) => ({
        recordType: row.recordType,
        recordId: row.recordId,
        rights: row.rights,
      })),
    };
    try {
      await saveProjectPermissions(projectId, body);
      setSaved(true);
      // A successful write is the product result; a failed refresh must not
      // relabel it as a failed save. The next open loads the canonical state.
      try {
        const next = await fetchProjectPermissions(projectId);
        setSnapshot(next);
        setCustomRows(next.customized);
        setInheritedRows(next.inherited);
        setIsInherit(next.isInherit);
      } catch {
        // Keep the confirmed save state; the drawer can be reopened to refresh.
      }
    } catch {
      setError(t('nextorePermissions.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <Dialog
        className={styles.dialog}
        ariaLabelledBy={titleId}
        onClose={onClose}
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
        data-testid="nextore-project-permissions"
      >
        <div className={styles.header}>
          <div>
            <h2 id={titleId} className={styles.title}>{t('nextorePermissions.title')}</h2>
            <p className={styles.description}>{t('nextorePermissions.description')}</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} disabled={saving} aria-label={t('common.close')}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {loading ? (
          <p className={styles.hint}>{t('common.loading')}</p>
        ) : error && !snapshot ? (
          <div className={styles.errorBlock} role="alert">
            <p>{error}</p>
            <Button type="button" onClick={() => { void load(); }}>{t('nextorePermissions.retry')}</Button>
          </div>
        ) : snapshot ? (
          <div className={styles.body}>
            {!canEdit ? <p className={styles.warning}>{t('nextorePermissions.readOnly')}</p> : null}
            <label className={styles.inlineCheck}>
              <input
                type="checkbox"
                checked={isInherit}
                disabled={!canEdit}
                onChange={(event) => {
                  setIsInherit(event.currentTarget.checked);
                  setSaved(false);
                }}
              />
              <span>{t('nextorePermissions.inherit')}</span>
            </label>

            {isInherit ? (
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>{t('nextorePermissions.inheritedFrom')}</h3>
                <PermissionTable
                  rows={inheritedRows}
                  readOnly
                  emptyLabel={t('nextorePermissions.noInherited')}
                  caption={t('nextorePermissions.inheritedFrom')}
                  t={t}
                />
              </section>
            ) : null}

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>{t('nextorePermissions.projectAccess')}</h3>
              <PermissionTable
                rows={customRows}
                readOnly={!canEdit}
                emptyLabel={t('nextorePermissions.noCustom')}
                caption={t('nextorePermissions.projectAccess')}
                t={t}
                onToggle={toggleRow}
                onRemove={removeRow}
              />
              <div className={styles.sectionActions}>
                <Button type="button" onClick={() => setPickerOpen(true)} disabled={!canEdit || saving}>
                  <Icon name="plus" size={14} /> {t('nextorePermissions.add')}
                </Button>
              </div>
              {!hasManager ? <p className={styles.warning}>{t('nextorePermissions.managerRequired')}</p> : null}
              <label className={styles.inlineCheck}>
                <input
                  type="checkbox"
                  checked={applyToChildren}
                  disabled={!canEdit}
                  onChange={(event) => {
                    setApplyToChildren(event.currentTarget.checked);
                    setSaved(false);
                  }}
                />
                <span>{t('nextorePermissions.applyToChildren')}</span>
              </label>
            </section>

            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            {saved ? <p className={styles.saved} role="status">{t('nextorePermissions.saved')}</p> : null}
          </div>
        ) : null}

        <div className={styles.footer}>
          <Button type="button" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canEdit || !hasManager || saving || loading}
            onClick={() => { void save(); }}
          >
            {saving ? t('nextorePermissions.saving') : t('common.save')}
          </Button>
        </div>
      </Dialog>
      <GroupMemberPicker
        projectId={projectId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={addSelected}
      />
    </>
  );
}
