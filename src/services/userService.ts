import { userQueryMethods } from './users/userQueries';
import { storeAdministrationMethods } from './users/storeAdministration';
import { ownerManagementMethods } from './users/ownerManagement';
import { staffManagementMethods } from './users/staffManagement';
import { userProfileMethods } from './users/userProfiles';
import { userPermissionMethods } from './users/userPermissions';
import { storeSettingsMethods } from './users/storeSettings';
import { storePreferenceMethods } from './users/storePreferences';

export { PERMISSIONS_CHANGED_EVENT, STORE_AUTO_LOCK_CHANGED_EVENT } from './userEvents';

export const userService = {
  ...userQueryMethods,
  ...storeAdministrationMethods,
  ...ownerManagementMethods,
  ...staffManagementMethods,
  ...userProfileMethods,
  ...userPermissionMethods,
  ...storeSettingsMethods,
  ...storePreferenceMethods,
};
