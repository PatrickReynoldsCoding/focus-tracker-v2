// Every feature module. Remove a line to remove a feature (and its tables stay unused).
import type { Module } from '../core/registry';
import { basicsModule } from './basics';
import { extrasModule } from './extras';
import { habitsModule } from './habits';
import { listsModule } from './lists';
import { notesModule } from './notes';
import { notificationsModule } from './notifications';
import { notifyPrefsModule } from './notify-prefs';
import { projectsModule } from './projects';
import { sessionsModule } from './sessions';
import { relationsModule } from './relations';
import { swiftbarModule } from './swiftbar';
import { systemModule } from './system';
import { todayModule } from './today';
import { todayPanelsModule } from './today-panels';

export const MODULES: Module[] = [
  projectsModule,
  basicsModule,
  relationsModule,
  listsModule,
  notesModule,
  habitsModule,
  todayModule,
  sessionsModule,
  todayPanelsModule,
  notificationsModule,
  notifyPrefsModule,
  extrasModule,
  swiftbarModule,
  systemModule,
];
