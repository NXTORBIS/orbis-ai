import { useEffect } from 'react';
import { useStore } from '../state/store';
import { spaces, loadSpaces, createSpace, deleteSpace, setActiveSpace, updateSpace } from '../state/spaces';
import { prompt, toast } from '../state/app';
import { navigate, activePane } from '../state/workspace';
import { Icon } from '../ui/Icon';
import { SEP, useMenu, type MenuItem } from '../ui/components';
import { call } from '../api';

export function SpaceSwitcher() {
  const { list, activeId, loaded } = useStore(spaces, (s) => ({ list: s.spaces, activeId: s.activeSpaceId, loaded: s.loaded }));
  const menu = useMenu();

  useEffect(() => {
    if (!loaded) void loadSpaces();
  }, [loaded]);

  const active = list.find((s) => s.id === activeId);

  const switchTo = (space: typeof list[0]) => {
    setActiveSpace(space.id);
    if (space.folders.length > 0) {
      void navigate(activePane().id, { kind: 'fs', path: space.folders[0]! });
    }
  };

  const handleCreate = async () => {
    const name = await prompt({ title: 'New space', label: 'Space name', initial: 'My Space', confirmLabel: 'Create' });
    if (!name) return;
    const folderPath = await call('fs:pickDirectory', { title: 'Choose a folder for this space' }) as string | null;
    if (!folderPath) return;
    const space = await createSpace(name, [folderPath]);
    setActiveSpace(space.id);
    toast({ level: 'success', title: `Space "${name}" created` });
  };

  const handleAddFolder = async (space: typeof list[0]) => {
    const folderPath = await call('fs:pickDirectory', { title: 'Add folder to space' }) as string | null;
    if (!folderPath) return;
    if (space.folders.includes(folderPath)) { toast({ level: 'info', title: 'This folder is already in the space' }); return; }
    await updateSpace(space.id, { folders: [...space.folders, folderPath] });
    toast({ level: 'success', title: `Folder added to "${space.name}"` });
  };

  const handleDelete = async (space: typeof list[0]) => {
    await deleteSpace(space.id);
    toast({ level: 'success', title: `Space "${space.name}" deleted` });
  };

  const items = (): MenuItem[] => [
    { label: 'All files', checked: activeId === null, run: () => setActiveSpace(null) },
    ...(list.length ? [SEP] : []),
    ...list.map((s) => ({
      label: s.name,
      checked: s.id === activeId,
      submenu: [
        { label: 'Switch to this space', run: () => switchTo(s) },
        { label: `${s.folders.length} folder${s.folders.length === 1 ? '' : 's'}`, disabled: true, run: () => {} },
        SEP,
        { label: 'Add folder…', icon: 'plus', run: () => void handleAddFolder(s) },
        { label: 'Delete space', danger: true, run: () => void handleDelete(s) },
      ],
    })),
    SEP,
    { label: 'New space…', icon: 'plus', run: () => void handleCreate() },
  ];

  return (
    <>
      <button
        type="button"
        className="space-switch no-drag"
        aria-haspopup="menu"
        aria-label={`Space: ${active?.name ?? 'All files'}. Change space`}
        data-tip="Virtual Workspace"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          menu.open(items(), r.right, r.bottom + 4, 'right');
        }}
      >
        <Icon name="collection" size={14} />
        <span className="space-name">{active?.name ?? 'All files'}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {menu.node}
    </>
  );
}
