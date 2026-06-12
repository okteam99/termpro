// TermPro Host process — pure Node, zero Electron dependencies.
// Runs in a utilityProcess locally; designed to run standalone on a
// remote machine later (see README §5). Real implementation lands in S2.

// eslint-disable-next-line no-console
console.log('[host] booted, pid=%d', process.pid);
