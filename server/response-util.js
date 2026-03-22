// Utility helpers for sending responses safely (avoid double-send errors)
module.exports = {
  safeJson: (res, obj) => {
    if (!res || res.headersSent || res.finished) return;
    try { res.json(obj); } catch (e) {}
  },
  safeStatusJson: (res, status, obj) => {
    if (!res || res.headersSent || res.finished) return;
    try { res.status(status).json(obj); } catch (e) {}
  },
  safeSend: (res, body, status) => {
    if (!res || res.headersSent || res.finished) return;
    try {
      if (typeof status === 'number') res.status(status);
      res.send(body);
    } catch (e) {}
  }
  , safeSendFile: (res, filePath) => {
    if (!res || res.headersSent || res.finished) return;
    try { res.sendFile(filePath); } catch (e) {}
  }
};
