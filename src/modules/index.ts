// Every feature module. Remove a line to remove a feature (and its tables stay unused).
import type { Module } from '../core/registry';
import { addPanelModule } from './add-panel';
import { basicsModule } from './basics';
import { categoriesModule } from './categories';
import { boardsModule } from './boards';
import { desktopModule } from './desktop';
import { doneColumnModule } from './done-column';
import { filesModule } from './files';
import { focusQueueModule } from './focus-queue';
import { habitsModule } from './habits';
import { insightsModule } from './insights';
import { layoutModule } from './layout';
import { listsModule } from './lists';
import { navigationModule } from './navigation';
import { notesModule } from './notes';
import { offlineModule } from './offline';
import { planModule } from './plan';
import { profilesModule } from './profiles';
import { pomodoroModule } from './pomodoro';
import { notificationsModule } from './notifications';
import { notifyPrefsModule } from './notify-prefs';
import { panelRestyleModule } from './panel-restyle';
import { projectLabelsModule } from './project-labels';
import { categoryButtonsModule } from './category-buttons';
import { projectsModule } from './projects';
import { resourcesModule } from './resources';
import { sessionsModule } from './sessions';
import { settingScopeModule } from './setting-scope';
import { stickiesModule } from './stickies';
import { subtasksModule } from './subtasks';
import { relationsModule } from './relations';
import { swiftbarModule } from './swiftbar';
import { tagsModule } from './tags';
import { systemModule } from './system';
import { todayModule } from './today';
import { todayListModule } from './today-list';
import { todayPanelsModule } from './today-panels';
import { todosModule } from './todos';
import { whiteboardsModule } from './whiteboards';
import { widgetsModule } from './widgets';

export const MODULES: Module[] = [
  projectsModule,
  boardsModule,
  doneColumnModule,
  subtasksModule,
  focusQueueModule,
  basicsModule,
  categoriesModule,
  profilesModule,
  resourcesModule,
  relationsModule,
  listsModule,
  todosModule,
  notesModule,
  navigationModule,
  projectLabelsModule,
  panelRestyleModule,
  categoryButtonsModule,
  habitsModule,
  planModule,
  todayModule,
  sessionsModule,
  pomodoroModule,
  todayPanelsModule,
  todayListModule,
  notificationsModule,
  notifyPrefsModule,
  whiteboardsModule,
  offlineModule,
  layoutModule,
  addPanelModule,
  desktopModule,
  stickiesModule,
  insightsModule,
  tagsModule,
  // After every module with files: deleting a project deletes or clears its files before its folder.
  filesModule,
  widgetsModule,
  swiftbarModule,
  settingScopeModule,
  systemModule,
];
