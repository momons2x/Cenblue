export const xSelectors = {
  accountMenuButton: "[data-testid='SideNav_AccountSwitcher_Button']",
  profileLink: "a[aria-label='Profile'][href^='/']",
  loginLink: "a[href='/login']",
  timelinePost: "article",
  statusLink: "a[href*='/status/']",
  tweetText: "div[lang][dir='auto']",
  timestamp: "time[datetime]",
  video: "video, [data-testid='videoPlayer'], [data-testid='videoComponent']",
  socialContext: "[data-testid='socialContext']",
} as const;
