// 云端浏览器标签条/地址栏共用的小判定,拆出来是因为两处(标签 label、地址栏空态)
// 都要认同一套「这是空白页」的标准,判定跑偏一处就会串到另一处。

/** 云端标签是否是"空白页"(地址栏应显示为空,并给空态提示)。
 *  新开的云端标签、以及浏览器自带的新标签页都落在这几种 URL 上——它们对用户
 *  没有意义,不该在地址栏里原样拼出来。 */
export function isBlankCloudUrl(url: string): boolean {
  return (
    url === '' ||
    url === 'about:blank' ||
    url.startsWith('chrome://newtab') ||
    url.startsWith('chrome://new-tab-page')
  );
}
