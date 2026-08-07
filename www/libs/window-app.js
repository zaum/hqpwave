// App-specific functionality in window scope

/** Must be defined before _any_ app modules */
window.cl = console.log;

/**
 * Returns error message string or null.
 * Uses `platform.js`.
 */
window.isSafariTooLow = () => {
  if (platform.name != 'Safari') {
    return;
  }
  const osFamily = (platform.os && platform.os.family) ? platform.os.family : '';
  const isIos = osFamily.includes('iOS');
  const isOsx = osFamily.includes('OS X');
  if (isIos) {
    // ios safari relies on os version, not browser version (sigh).
    const osVersion = (platform.os && platform.os.version && parseFloat(platform.os.version))
        ? parseFloat(platform.os.version)
        : 0;
    if (osVersion > 0 && osVersion < 12) {
      return "HQPWV requires iOS 12+.";
    }
  } else if (isOsx) {
    const browserVersionFloat = parseFloat(platform.version);
    if (browserVersionFloat > 0 && browserVersionFloat < 12) {
      return "HQPWV requires desktop Safari v12+ or a different browser.";
    }
  }
  return null;
};
