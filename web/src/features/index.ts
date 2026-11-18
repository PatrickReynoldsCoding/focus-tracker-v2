// Every web feature, imported once for its registrations (see core/registry.tsx).
// Add a feature: make web/src/features/<name>/index.ts(x) and import it here. Order here does not matter;
// each registration has its own order number.
import './today/Today';
import './habits/TodayHabits';
import './habits/Habits';
import './projects/Projects';
import './projects/ProjectPage';
import './notes/Notes';
import './log/Log';
import './settings/Settings';
import './today-panels/index';
import './modes/Modes';
import './criteria/Criteria';
