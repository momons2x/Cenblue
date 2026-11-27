export const xPublisherSelectors = {
  accountMenuButton: "[data-testid='SideNav_AccountSwitcher_Button']",
  profileLink: "a[aria-label='Profile'][href^='/']",
  loginLink: "a[href='/login']",
  composer: "textarea[aria-label=\"What's happening?\"], textarea[placeholder=\"What's happening?\"], [data-testid='tweetTextarea_0']",
  composerDialog: "[role='dialog']",
  mediaInput: "input[type='file'][accept*='video'], input[type='file'], input[data-testid='fileInput']",
  mediaAttachment: "[aria-label^='Remove '], [data-testid='attachments'], [data-testid='videoPlayer'], [data-testid='removeMedia']",
  publishButton: "button:has-text('Post'):visible, [data-testid='tweetButton']:visible, [data-testid='tweetButtonInline']:visible",
  publishButtonAny: "button:has-text('Post'), [data-testid='tweetButton'], [data-testid='tweetButtonInline']",
  alert: "[role='alert']",
  toast: "[data-testid='toast'], [role='alert']",
  statusLink: "a[href*='/status/']",
} as const;
