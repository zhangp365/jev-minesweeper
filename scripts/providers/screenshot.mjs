// Keep the preview metadata shared across providers and image bytes out of logs.
export function screenshotLog(screenshot) {
  if (!screenshot) return {};
  return { screenshot: {
    path: screenshot.path, bytes: screenshot.bytes, mimeType: "image/png",
    ...(screenshot.width && screenshot.height ? { width: screenshot.width, height: screenshot.height } : {})
  } };
}

export function omittedImageData(screenshot) {
  return `[base64 omitted; ${screenshot.bytes} bytes; see screenshot file]`;
}
