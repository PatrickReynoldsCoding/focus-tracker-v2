// Whiteboards, and the tables Google Drive sync will use (Phase 4).

import type { Entity } from '../core/entity';
import type { Module } from '../core/registry';

export const whiteboardsEntity: Entity = {
  name: 'whiteboards',
  table: 'whiteboards',
  singular: 'whiteboard',
  desc: 'Excalidraw whiteboards, optionally on a project. scene is the Excalidraw scene JSON.',
  modeScoped: true,
  orderGroup: [],
  filters: ['project_id', 'show_today'],
  fields: {
    name: { type: 'text', required: true },
    project_id: { type: 'text', ref: 'projects', cascade: true },
    show_today: { type: 'bool', default: false },
    scene: { type: 'json' },
    thumbnail: { type: 'text', desc: 'Small data: URL preview' },
  },
};

export const accountsEntity: Entity = {
  name: 'accounts',
  table: 'accounts',
  singular: 'Google account',
  desc: 'Connected Google accounts for Drive sync. Tokens never leave the server.',
  modeScoped: false,
  internal: true,
  fields: {
    email: { type: 'text', required: true },
    scopes: { type: 'text', readonly: true },
    status: { type: 'text', enum: ['ok', 'needs_login', 'blocked'], readonly: true },
    last_sync: { type: 'time', readonly: true },
  },
};

export const driveLinksEntity: Entity = {
  name: 'drive_links',
  table: 'drive_links',
  singular: 'Drive link',
  desc: 'Which Drive file mirrors which row, and its sync state.',
  modeScoped: false,
  internal: true,
  filters: ['entity', 'entity_id', 'state'],
  fields: {
    entity: { type: 'text', required: true },
    entity_id: { type: 'text', required: true },
    account_id: { type: 'text', required: true, ref: 'accounts' },
    file_id: { type: 'text' },
    drive_version: { type: 'text' },
    synced_version: { type: 'text' },
    state: { type: 'text', enum: ['in_sync', 'pending', 'conflict', 'error'] },
    error: { type: 'text' },
  },
};

export const extrasModule: Module = {
  id: 'extras',
  description: 'Whiteboards, and the Google accounts and Drive links used by Drive sync.',
  entities: [whiteboardsEntity, accountsEntity, driveLinksEntity],
};
