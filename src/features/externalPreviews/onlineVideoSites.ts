export interface OnlineVideoSite {
  id: string;
  name: string;
  urlTemplate: string;
  icon?: string;
  enabled: boolean;
}

export const ONLINE_VIDEO_SITES: OnlineVideoSite[] = [
  {
    id: '123av',
    name: '123AV',
    urlTemplate: 'https://www.123av.com/search/{{code}}',
    enabled: true,
  },
  {
    id: 'supjav',
    name: 'SupJAV',
    urlTemplate: 'https://supjav.com/?s={{code}}',
    enabled: true,
  },
  {
    id: 'javguru',
    name: 'JAV.Guru',
    urlTemplate: 'https://jav.guru/?s={{code}}',
    enabled: true,
  },
  {
    id: 'javgg',
    name: 'JAVGG',
    urlTemplate: 'https://javgg.net/search/{{code}}',
    enabled: true,
  },
  {
    id: 'javfree',
    name: 'JavFree',
    urlTemplate: 'https://javfree.me/search/{{code}}',
    enabled: true,
  },
  {
    id: 'javstore',
    name: 'JavStore',
    urlTemplate: 'https://javstore.net/search?q={{code}}',
    enabled: true,
  },
  {
    id: 'blogjav',
    name: 'BlogJav',
    urlTemplate: 'https://blogjav.net/search?q={{code}}',
    enabled: true,
  },
];

export function buildOnlineVideoLinks(code: string): OnlineVideoSite[] {
  const normalizedCode = encodeURIComponent(code.toUpperCase().trim());
  
  return ONLINE_VIDEO_SITES
    .filter(site => site.enabled)
    .map(site => ({
      ...site,
      urlTemplate: site.urlTemplate.replace('{{code}}', normalizedCode),
    }));
}

export function renderOnlineVideoLinks(code: string): HTMLElement | null {
  const links = buildOnlineVideoLinks(code);
  if (links.length === 0) return null;

  const existingPanel = document.getElementById('jdb-online-video-panel');
  if (existingPanel) existingPanel.remove();

  const panel = document.createElement('div');
  panel.id = 'jdb-online-video-panel';
  panel.className = 'panel-block jdb-external-search-panel';

  const label = document.createElement('strong');
  label.textContent = '在线视频:';
  panel.appendChild(label);

  const value = document.createElement('span');
  value.className = 'value jdb-online-video-links';
  value.style.marginLeft = '0.5rem';

  links.forEach(site => {
    const link = document.createElement('a');
    link.href = site.urlTemplate;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'tag is-warning is-light is-small jdb-online-video-link';
    link.textContent = site.name;
    link.title = `在 ${site.name} 搜索 ${code}`;
    value.appendChild(link);
  });

  panel.appendChild(value);
  return panel;
}
