function createQrCamera(readerId, maxBoxSize) {
  let active = null;
  let cleanup = null;

  function clear(scanner) {
    try { scanner.clear(); }
    catch (error) { console.warn('カメラ表示を消去できませんでした。', error); }
  }

  return {
    get active() { return active !== null; },

    async start(onScan) {
      if (active) return false;
      const session = {};
      active = session;

      // Let any previous stream release the reader before reusing it.
      if (cleanup) await cleanup;
      if (active !== session) return false;

      try {
        const scanner = new Html5Qrcode(readerId);
        session.scanner = scanner;
        session.started = scanner.start({ facingMode: 'environment' }, {
          fps: 10,
          qrbox: (width, height) => {
            const size = Math.floor(Math.min(maxBoxSize, width * 0.8, height * 0.8));
            return { width: size, height: size };
          }
        }, text => {
          if (active === session) onScan(text);
        });
        await session.started;
        return active === session;
      } catch (error) {
        if (active !== session) return false;
        active = null;
        if (session.scanner) clear(session.scanner);
        throw error;
      }
    },

    stop() {
      const session = active;
      active = null;
      if (!session?.scanner) return cleanup;

      cleanup = (async () => {
        try {
          // The permission prompt may still be open when the reader is closed.
          await session.started;
          await session.scanner.stop();
        } catch {
          // Permission may have been denied before the stream started.
        } finally {
          clear(session.scanner);
        }
      })();
      return cleanup;
    }
  };
}

function cameraErrorMessage(error) {
  if (window.isSecureContext === false) return 'カメラを使うにはHTTPSでこのページを開いてください。';
  if (/NotAllowedError|PermissionDeniedError|permission denied|permission dismissed/i.test(String(error))) {
    return 'カメラの使用が許可されていません。ブラウザのサイト設定でカメラを許可してから、もう一度開いてください。';
  }
  if (/NotFoundError|DevicesNotFoundError/i.test(String(error))) return '利用できるカメラが見つかりません。';
  return 'カメラを起動できませんでした。カメラの接続やブラウザの設定を確認してください。';
}
