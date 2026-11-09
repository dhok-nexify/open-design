import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AppConfig } from '../types';
import { useAnalytics } from '../analytics/provider';
import {
  trackIntegrationsConnectorsTabClick,
  trackIntegrationsTabClick,
  trackPageView,
  trackSettingsConnectorAuthResult,
} from '../analytics/events';
import { ConnectorSection } from './SettingsDialog';
import { Icon } from './Icon';
import { McpClientSection } from './McpClientSection';
import { SkillsSection } from './SkillsSection';
import { UseEverywhereGuidePanel } from './UseEverywhereModal';
import { useT } from '../i18n';
import { NEXTORE_WEB_EDITION } from '../nextore/features';
import {
  visibleIntegrationTabIds,
  type IntegrationTab,
} from '../nextore/integration-tabs';

export type { IntegrationTab } from '../nextore/integration-tabs';

interface Props {
  config: AppConfig;
  initialTab?: IntegrationTab;
  composioConfigLoading?: boolean;
  onConfigPersist: (config: AppConfig) => Promise<void> | void;
  onPersistComposioKey: (composio: AppConfig['composio']) => Promise<void> | void;
  onSkillsRefresh?: () => Promise<void> | void;
  onSkillsChanged?: (affectedSkillId?: string) => void;
}

const INTEGRATION_TABS: ReadonlyArray<{
  id: IntegrationTab;
}> = [
  { id: 'mcp' },
  { id: 'connectors' },
  { id: 'skills' },
  { id: 'use-everywhere' },
];

function integrationTabToTrackingElement(
  id: IntegrationTab,
): 'mcp' | 'connectors' | 'skills' | 'use_everywhere' {
  if (id === 'use-everywhere') return 'use_everywhere';
  return id;
}

export function IntegrationsView({
  config,
  initialTab = 'mcp',
  composioConfigLoading = false,
  onConfigPersist,
  onPersistComposioKey,
  onSkillsRefresh,
  onSkillsChanged,
}: Props) {
  const t = useT();
  const analytics = useAnalytics();
  const integrationsPageViewFiredRef = useRef(false);
  useEffect(() => {
    if (integrationsPageViewFiredRef.current) return;
    integrationsPageViewFiredRef.current = true;
    trackPageView(analytics.track, { page_name: 'integrations' });
  }, [analytics.track]);
  const [activeTab, setActiveTab] = useState<IntegrationTab>(initialTab);
  // The edition scopes MCP config to the member and requires DesignerManageMcp,
  // so the tab only exists after that access probe says yes. Upstream has no
  // such gate.
  const [mcpAllowed, setMcpAllowed] = useState(
    NEXTORE_WEB_EDITION !== 'nextore',
  );
  const [localConfig, setLocalConfig] = useState<AppConfig>(config);
  const localConfigRef = useRef(localConfig);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (NEXTORE_WEB_EDITION !== 'nextore') return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/nextore/mcp/access');
        if (!response.ok) {
          if (!cancelled) setMcpAllowed(false);
          return;
        }
        const payload = (await response.json()) as { allowed?: unknown };
        if (!cancelled) setMcpAllowed(payload.allowed === true);
      } catch {
        if (!cancelled) setMcpAllowed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleTabs = useMemo(() => {
    const ids = new Set(visibleIntegrationTabIds(mcpAllowed));
    return INTEGRATION_TABS.filter((tab) => ids.has(tab.id));
  }, [mcpAllowed]);

  useEffect(() => {
    if (visibleTabs.some((tab) => tab.id === activeTab)) return;
    setActiveTab(visibleTabs[0]?.id ?? 'skills');
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    setLocalConfig((current) => {
      const pendingComposioKey = current.composio?.apiKey ?? '';
      const reconciled = pendingComposioKey.trim()
        ? {
            ...config,
            composio: {
              ...(config.composio ?? {}),
              apiKey: pendingComposioKey,
            },
          }
        : config;
      localConfigRef.current = reconciled;
      return reconciled;
    });
  }, [config]);

  const updateLocalDraft = useCallback<Dispatch<SetStateAction<AppConfig>>>((nextConfig) => {
    const base = localConfigRef.current;
    const resolved =
      typeof nextConfig === 'function'
        ? (nextConfig as (current: AppConfig) => AppConfig)(base)
        : nextConfig;
    localConfigRef.current = resolved;
    setLocalConfig(resolved);
  }, []);

  const updateLocalConfig = useCallback<Dispatch<SetStateAction<AppConfig>>>(
    (nextConfig) => {
      const base = localConfigRef.current;
      const resolved =
        typeof nextConfig === 'function'
          ? (nextConfig as (current: AppConfig) => AppConfig)(base)
          : nextConfig;
      localConfigRef.current = resolved;
      setLocalConfig(resolved);
      void onConfigPersist(resolved);
    },
    [onConfigPersist],
  );

  const liveDaemonUrl =
    typeof window !== 'undefined' ? window.location.origin : undefined;

  return (
    <section className="integrations-view" aria-labelledby="integrations-title">
      <header className="integrations-view__hero">
        <div>
          <p className="integrations-view__kicker">{t('integrations.kicker')}</p>
          <h1 id="integrations-title" className="entry-section__title">
            {t('entry.navIntegrations')}
          </h1>
          <p className="integrations-view__lede">
            {t('integrations.lede')}
          </p>
        </div>
        <div className="integrations-view__badge" aria-hidden="true">
          <Icon name="link" size={15} />
          <span>{t('integrations.agentReady')}</span>
        </div>
      </header>

      <nav
        className="integrations-view__tabs"
        role="tablist"
        aria-label={t('integrations.areasAria')}
      >
        {visibleTabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`integrations-view__tab${active ? ' is-active' : ''}`}
              onClick={() => {
                trackIntegrationsTabClick(analytics.track, {
                  page_name: 'integrations',
                  area: 'integrations_tab',
                  element: integrationTabToTrackingElement(tab.id),
                });
                setActiveTab(tab.id);
              }}
              data-testid={`integrations-tab-${tab.id}`}
            >
              <span className="integrations-view__tab-label">{integrationTabLabel(tab.id, t)}</span>
              <span className="integrations-view__tab-hint">{integrationTabHint(tab.id, t)}</span>
            </button>
          );
        })}
      </nav>

      <div className="integrations-view__panel">
        {activeTab === 'mcp' ? <McpClientSection /> : null}

        {activeTab === 'connectors' ? (
          <ConnectorSection
            cfg={localConfig}
            setCfg={updateLocalDraft}
            composioConfigLoading={composioConfigLoading}
            onPersistComposioKey={onPersistComposioKey}
            onConnectorsTabClick={(element) =>
              trackIntegrationsConnectorsTabClick(analytics.track, {
                page_name: 'integrations',
                area: 'connectors_tab',
                element,
              })
            }
            onConnectorAuthResult={({ connectorId, action, result, errorCode }) =>
              trackSettingsConnectorAuthResult(analytics.track, {
                page_name: 'settings',
                area: 'connectors',
                connector_id: connectorId,
                action,
                result,
                ...(errorCode ? { error_code: errorCode } : {}),
              })
            }
          />
        ) : null}

        {activeTab === 'skills' ? (
          <SkillsSection
            cfg={localConfig}
            setCfg={updateLocalConfig}
            onSkillsRefresh={onSkillsRefresh}
            onSkillsChanged={onSkillsChanged}
          />
        ) : null}

        {activeTab === 'use-everywhere' ? (
          <div className="integrations-view__use-everywhere">
            <UseEverywhereGuidePanel
              onOpenSettings={() => setActiveTab('mcp')}
              {...(liveDaemonUrl ? { daemonUrl: liveDaemonUrl } : {})}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function integrationTabLabel(id: IntegrationTab, t: ReturnType<typeof useT>): string {
  switch (id) {
    case 'mcp': return t('integrations.tabLabel.mcp');
    case 'connectors': return t('entry.tabConnectors');
    case 'skills': return t('integrations.tabLabel.skills');
    case 'use-everywhere': return t('entry.useEverywhereTitle');
  }
}

function integrationTabHint(id: IntegrationTab, t: ReturnType<typeof useT>): string {
  switch (id) {
    case 'mcp': return t('integrations.tabHint.mcp');
    case 'connectors': return t('integrations.tabHint.connectors');
    case 'skills': return t('settings.skillsHint');
    case 'use-everywhere': return t('integrations.tabHint.useEverywhere');
  }
}
