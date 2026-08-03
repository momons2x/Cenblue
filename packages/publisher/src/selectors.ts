export const xPublisherSelectors = {
  accountMenuButton: "[data-testid='SideNav_AccountSwitcher_Button']",
  loginLink: "a[href='/login']",
  composer: "[data-testid='tweetTextarea_0']",
  composerDialog: "[role='dialog']",
  mediaInput: "input[data-testid='fileInput']",
  mediaAttachment: "[data-testid='attachments'], [data-testid='videoPlayer'], [data-testid='removeMedia']",
  publishButton: "[data-testid='tweetButton']:visible, [data-testid='tweetButtonInline']:visible",
  publishButtonAny: "[data-testid='tweetButton'], [data-testid='tweetButtonInline']",
  alert: "[role='alert']",
  toast: "[data-testid='toast']",
  statusLink: "a[href*='/status/']",
} as const;
