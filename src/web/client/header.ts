const header = document.querySelector<HTMLElement>('.app-header');
let previousScroll = Math.max(0, window.scrollY);

const resetHeader = () => {
  previousScroll = Math.max(0, window.scrollY);
  header?.classList.toggle('is-scrolled', previousScroll > 0);
  header?.classList.remove('is-hidden');
};
const updateHeader = () => {
  const scroll = Math.max(0, window.scrollY);
  header?.classList.toggle('is-scrolled', scroll > 0);
  if (scroll === 0) header?.classList.remove('is-hidden');
  else if (scroll !== previousScroll) header?.classList.toggle('is-hidden', scroll > previousScroll);
  previousScroll = scroll;
};

resetHeader();
window.addEventListener('scroll', updateHeader, {passive: true});
// Keep navigation visible when returning to a previously scrolled page.
window.addEventListener('pageshow', resetHeader);
