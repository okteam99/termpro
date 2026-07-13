/**
 * 远程图片上传是异步的。上传期间若用户继续键入,不能让新输入抢在图片路径前到达 PTY。
 * barrier 把 Term.onData 分成「TermPro 注入的 paste」与「用户随后输入」两队,完成时按此前后
 * 顺序 drain。它不认识 HostClient/session,会话一致性由 terminalRegistry 在 flush 前复核。
 */
export class RemotePasteInputBarrier {
  private userData: string[] = [];
  private injectedData: string[] = [];
  private injecting = false;

  capture(data: string): void {
    (this.injecting ? this.injectedData : this.userData).push(data);
  }

  inject(runPaste: () => void): void {
    this.injecting = true;
    try {
      runPaste();
    } finally {
      this.injecting = false;
    }
  }

  drain(): string[] {
    const ordered = [...this.injectedData, ...this.userData];
    this.injectedData = [];
    this.userData = [];
    return ordered;
  }
}
