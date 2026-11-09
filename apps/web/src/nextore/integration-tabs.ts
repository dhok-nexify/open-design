import { isFeatureEnabled } from './features';

export type IntegrationTab = 'mcp' | 'connectors' | 'skills' | 'use-everywhere';

const ALL: readonly IntegrationTab[] = [
  'mcp',
  'connectors',
  'skills',
  'use-everywhere',
];

/**
 * Integration tabs this build exposes. The edition removes connector memory
 * (D28), the daemon-as-MCP-server guide (D21), and MCP itself until the
 * member's DesignerManageMcp probe answers yes.
 */
export function visibleIntegrationTabIds(mcpAllowed: boolean): IntegrationTab[] {
  return ALL.filter((id) => {
    if (id === 'connectors') return isFeatureEnabled('connectors');
    if (id === 'use-everywhere') return isFeatureEnabled('od-mcp-server');
    if (id === 'mcp') return mcpAllowed;
    return true;
  });
}
