/* Panel host — maps sidebar view ids to page components inside the 3rd panel. */
import React from 'react';
import SnapStudioView from '../pages/SnapStudioView.jsx';
import StoriesView from '../pages/StoriesView.jsx';
import ContactsView from '../pages/ContactsView.jsx';
import GroupsView from '../pages/GroupsView.jsx';
import CommunitiesView from '../pages/CommunitiesView.jsx';
import ChannelsView from '../pages/ChannelsView.jsx';
import AIPanelView from '../pages/AIPanelView.jsx';
import CallsView from '../pages/CallsView.jsx';
import MediaView from '../pages/MediaView.jsx';
import SearchView from '../pages/SearchView.jsx';
import SettingsView from '../pages/SettingsView.jsx';
import AdminView from '../pages/AdminView.jsx';
import AView from '../pages/ArchiveView.jsx';
import NView from '../pages/NotificationsView.jsx';

const MAP = {
  snaps: [SnapStudioView, 'Snaps'],
  stories: [StoriesView, 'Stories'],
  contacts: [ContactsView, 'Contacts'],
  groups: [GroupsView, 'Groups'],
  communities: [CommunitiesView, 'Communities'],
  channels: [ChannelsView, 'Channels'],
  ai: [AIPanelView, 'Vibe AI'],
  calls: [CallsView, 'Calls'],
  media: [MediaView, 'Media manager'],
  search: [SearchView, 'Search'],
  settings: [SettingsView, 'Settings'],
  admin: [AdminView, 'Admin'],
  archived: [AView, 'Archived chats'],
  notifications: [NView, 'Notifications'],
};

export default function PanelHost() {
  const { view } = usePanelView();
  const Entry = MAP[view];
  if (!Entry) return null;
  const [C2, title] = Entry;
  return (
    <section className="side-panel glass fades">
      <header className="panel-head"><h3>{title}</h3></header>
      <C2 />
    </section>
  );
}
import { useApp as usePanelView } from '../state/store.jsx';
