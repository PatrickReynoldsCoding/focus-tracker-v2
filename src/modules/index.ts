// Every feature module. Remove a line to remove a feature (and its tables stay unused).
import type { Module } from '../core/registry';
import { basicsModule } from './basics';
import { habitsModule } from './habits';
import { insightsModule } from './insights';
import { layoutModule } from './layout';
import { listsModule } from './lists';
import { navigationModule } from './navigation';
import { notesModule } from './notes';
import { offlineModule } from './offline';
import { planModule } from './plan';
import { notificationsModule } from './notifications';
import { notifyPrefsModule } from './notify-prefs';
import { projectsModule } from './projects';
import { resourcesModule } from './resources';
import { sessionsModule } from './sessions';
import { stickiesModule } from './stickies';
import { relationsModule } from './relations';
import { swiftbarModule } from './swiftbar';
import { systemModule } from './system';
import { todayModule } from './today';
import { todayPanelsModule } from './today-panels';
import { whiteboardsModule } from './whiteboards';

export const MODULES: Module[] = [
  projectsModule,
  basicsModule,
  resourcesModule,
  relationsModule,
  listsModule,
  notesModule,
  navigationModule,
  habitsModule,
  planModule,
  todayModule,
  sessionsModule,
  todayPanelsModule,
  notificationsModule,
  notifyPrefsModule,
  whiteboardsModule,
  offlineModule,
  layoutModule,
  stickiesModule,
  insightsModule,
  swiftbarModule,
  systemModule,
];
