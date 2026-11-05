import { describe, expect, it } from 'vitest';
import { detectViewer } from '../../src/adapters/instagram';

// Synthetic page snippets (invented ids); real pages embed this data in large inline scripts.
const big = 'x'.repeat(50_000);

describe('detectViewer', () => {
  it('finds the id in CurrentUserInitialData-style config', () => {
    const scripts = [
      big,
      `requireLazy(["CurrentUserInitialData",[],{"ACCOUNT_ID":"17841400000000001","USER_ID":"17841400000000001","NAME":"Fake","NON_FACEBOOK_USER_ID":"1000000001","IS_BUSINESS":false}])`,
    ];
    expect(detectViewer(scripts)).toEqual({
      viewerId: '1000000001',
      strategy: 'current-user-initial-data',
    });
  });

  it('older shared-data viewer object yields id and username', () => {
    const scripts = [
      `window._sharedData = {"config":{"viewer":{"id":"1000000002","username":"fake_me","full_name":"F"}}}`,
    ];
    expect(detectViewer(scripts)).toEqual({
      viewerId: '1000000002',
      username: 'fake_me',
      strategy: 'shared-data-viewer',
    });
  });

  it('logged-out pages ("0" or no match) → null', () => {
    expect(detectViewer(['{"NON_FACEBOOK_USER_ID":"0"}'])).toEqual({
      viewerId: null,
      strategy: 'none',
    });
    expect(detectViewer([big, '<p>Log in</p>'])).toEqual({ viewerId: null, strategy: 'none' });
    expect(detectViewer([])).toEqual({ viewerId: null, strategy: 'none' });
  });

  it('never extracts anything else from the scripts', () => {
    const scripts = ['{"csrf_token":"SECRET","NON_FACEBOOK_USER_ID":"1000000001","sessionid":"S"}'];
    expect(JSON.stringify(detectViewer(scripts))).not.toMatch(/SECRET|sessionid|"S"/);
  });
});
