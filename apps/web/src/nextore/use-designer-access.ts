'use client';

import { useEffect, useState } from 'react';

import { navigate, type Route } from '../router';
import { DESIGNER_ACCESS_REQUIRED_EVENT, isDesignerAccessRequired } from './access-required';
import { isFeatureEnabled } from './features';

/**
 * NexTore edition access gate.
 *
 * A signed-in member can lack the Designer access right; the daemon then
 * refuses every API call with DESIGNER_ACCESS_REQUIRED, so the shell must show
 * one refusal page rather than letting feature errors and the first-run router
 * strand the member on the upstream onboarding.
 *
 * Also redirects away from the upstream onboarding route, which this edition
 * does not ship: a deep link or stale redirect must not render a cloud/BYOK
 * sign-in page.
 */
export function useDesignerAccessGate(route: Route): boolean {
  const [designerAccessRequired, setDesignerAccessRequired] = useState(
    () => isDesignerAccessRequired(),
  );

  useEffect(() => {
    const onRequired = () => setDesignerAccessRequired(true);
    window.addEventListener(DESIGNER_ACCESS_REQUIRED_EVENT, onRequired);
    setDesignerAccessRequired(isDesignerAccessRequired());
    return () => window.removeEventListener(DESIGNER_ACCESS_REQUIRED_EVENT, onRequired);
  }, []);

  useEffect(() => {
    if (isFeatureEnabled('onboarding')) return;
    if (route.kind === 'home' && route.view === 'onboarding') {
      navigate({ kind: 'home', view: 'home' }, { replace: true });
    }
  }, [route]);

  return designerAccessRequired;
}
