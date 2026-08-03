export const xSelectors = {
  accountMenuButton: "[data-testid='SideNav_AccountSwitcher_Button']",
  loginLink: "a[href='/login']",
  timelinePost: "article[data-testid='tweet']",
  statusLink: "a[href*='/status/']",
  tweetText: "[data-testid='tweetText']",
  timestamp: "time[datetime]",
  video: "video, [data-testid='videoPlayer'], [data-testid='videoComponent']",
  socialContext: "[data-testid='socialContext']",
} as const;
