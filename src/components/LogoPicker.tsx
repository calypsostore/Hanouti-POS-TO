import { useMemo, useState } from 'react';
import { logoCatalog, logoGroupsList } from '../data/logoCatalog';
import { t } from '../i18n/translations';
import { BottomSheet } from './BottomSheet';
import { ItemLogo } from './ItemLogo';

interface LogoPickerProps {
  open: boolean;
  value: string;
  allowedGroups?: string[];
  onChange: (logoId: string) => void;
  onClose: () => void;
  panelClassName?: string;
}

export function LogoPicker({ open, value, allowedGroups, onChange, onClose, panelClassName }: LogoPickerProps) {
  const [group, setGroup] = useState(logoGroupsList[0] ?? '');
  const [search, setSearch] = useState('');
  const availableGroups = allowedGroups?.length ? allowedGroups : logoGroupsList;
  const selectedGroup = availableGroups.includes(group) ? group : availableGroups[0] ?? '';
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleLogos = useMemo(() => logoCatalog.filter((logo) =>
    availableGroups.includes(logo.group)
      && (normalizedSearch
        ? `${logo.label} ${logo.keywords.join(' ')}`.toLocaleLowerCase().includes(normalizedSearch)
        : logo.group === selectedGroup),
  ), [selectedGroup, normalizedSearch, availableGroups]);

  function chooseLogo(id: string) {
    onChange(id);
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t('logo.pickerTitle')} panelClassName={panelClassName}>
      <label className="relative mb-3 block">
        <span className="sr-only">{t('logo.search')}</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('logo.search')}
          className="h-12 w-full rounded-xl bg-surface-container-low pl-4 pr-3 font-body text-body-md outline-none focus:ring-2 focus:ring-primary"
        />
      </label>

      <div className="scrollbar-hidden -mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('logo.groupTabs')}>
        {availableGroups.map((groupName) => (
          <button
            key={groupName}
            type="button"
            role="tab"
            aria-selected={group === groupName && !normalizedSearch}
            onClick={() => { setGroup(groupName); setSearch(''); }}
            className={`min-h-10 shrink-0 rounded-full px-3 font-body text-label-sm ${group === groupName && !normalizedSearch ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}
          >
            {groupName}
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-pressed={!value}
        onClick={() => chooseLogo('')}
        className={`mb-3 flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left font-body text-label-md ${!value ? 'border-primary bg-primary-fixed' : 'border-outline-variant bg-surface-container-lowest'}`}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-dashed border-outline text-outline">—</span>
        {t('logo.noLogo')}
      </button>

      {visibleLogos.length > 0 ? (
        <div className="grid max-h-[45dvh] grid-cols-3 gap-2 overflow-y-auto pb-2 sm:grid-cols-4">
          {visibleLogos.map((logo) => (
            <button
              key={logo.id}
              type="button"
              aria-label={logo.label}
              aria-pressed={value === logo.id}
              onClick={() => chooseLogo(logo.id)}
              className={`flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center font-body text-label-sm text-on-surface ${value === logo.id ? 'border-primary bg-primary-fixed ring-1 ring-primary' : 'border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low'}`}
            >
              <ItemLogo id={logo.id} size="md" />
              <span className="line-clamp-2">{logo.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="py-8 text-center font-body text-body-sm text-on-surface-variant">{t('logo.noSearchResults')}</p>
      )}
    </BottomSheet>
  );
}
