import { useEffect, useRef, useState } from 'react';
import { hostClient } from './services/hostClient';
import TerminalView from './terminal/TerminalView';
import type { HostInfo } from '../shared/protocol';

// S3 阶段:单 tab 冒烟壳。S4 替换为完整三栏 UI。
export default function App() {
  const [info, setInfo] = useState<HostInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const smokeSent = useRef(false);

  useEffect(() => {
    hostClient.connect().then(setInfo, (e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="app-shell">
        <div className="placeholder">Host 连接失败:{error}</div>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="app-shell">
        <div className="placeholder">连接 Host…</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="terminal-area">
        <TerminalView
          tabId="smoke"
          cwd={info.homedir}
          active
          callbacks={{
            onFirstData: () => {
              if (!smokeSent.current) {
                smokeSent.current = true;
                window.termpro.smokeOk();
              }
            },
          }}
        />
      </div>
    </div>
  );
}
