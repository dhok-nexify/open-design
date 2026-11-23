// Dictionary keys that exist only in this downstream fork.
// Upstream locale files must never declare these; they live in ./locales/*.
export interface NextoreDict {
  
  
  /** NexTore edition: a signed-in member without the Designer access right. */
  'accessRequired.title': string;
  
  'accessRequired.body': string;
  
  'nextoreAccount.switchAccount': string;
  
  'nextoreAccount.signOut': string;
  
  'nextoreAccount.signOutFailed': string;

  /** NexTore edition: a rename moved the file's comment thread with it. */
  'nextore.comments.followedRename': string;

  /** NexTore edition: folder-level share section in the artifact dialog. */
  'nextore.project.share.title': string;

  /** NexTore edition: creates the folder ShareObject (distinct from a file link). */
  'nextore.project.share.create': string;

  /** NexTore edition: header entry that opens the folder share dialog. */
  'nextore.project.share.action': string;

  /** NexTore edition: file row menu entry that shares that exact file. */
  'nextore.artifact.share.rowAction': string;
  'nextorePermissions.title': string;
  'nextorePermissions.description': string;
  'nextorePermissions.inherit': string;
  'nextorePermissions.inheritedFrom': string;
  'nextorePermissions.projectAccess': string;
  'nextorePermissions.groupMember': string;
  'nextorePermissions.manage': string;
  'nextorePermissions.read': string;
  'nextorePermissions.edit': string;
  'nextorePermissions.delete': string;
  'nextorePermissions.download': string;
  'nextorePermissions.lock': string;
  'nextorePermissions.createFile': string;
  'nextorePermissions.createFolder': string;
  'nextorePermissions.add': string;
  'nextorePermissions.remove': string;
  'nextorePermissions.applyToChildren': string;
  'nextorePermissions.inherited': string;
  'nextorePermissions.owner': string;
  'nextorePermissions.noCustom': string;
  'nextorePermissions.noInherited': string;
  'nextorePermissions.loadFailed': string;
  'nextorePermissions.saveFailed': string;
  'nextorePermissions.saved': string;
  'nextorePermissions.managerRequired': string;
  'nextorePermissions.group': string;
  'nextorePermissions.member': string;
  'nextorePermissions.searchGroups': string;
  'nextorePermissions.searchMembers': string;
  'nextorePermissions.noGroups': string;
  'nextorePermissions.noMembers': string;
  'nextorePermissions.selectHint': string;
  'nextorePermissions.addTitle': string;
  'nextorePermissions.confirmAdd': string;
  'nextorePermissions.selected': string;
  'nextorePermissions.expand': string;
  'nextorePermissions.collapse': string;
  'nextorePermissions.retry': string;
  'nextorePermissions.saving': string;
  'nextorePermissions.readOnly': string;
  
  'signedOut.title': string;
  
  'signedOut.body': string;
  
  'signedOut.action': string;
  
  
  /** NexTore projects whose files live on another device. */
  'nextoreRemote.title': string;
  
  'nextoreRemote.hint': string;
  
  'nextoreRemote.notOnDevice': string;
  
  'nextoreRemote.notOnDeviceTitle': string;
  
  'nextoreRemote.remoteBadge': string;
  
  'nextoreWorkspace.allProjects': string;
  
  'nextoreWorkspace.currentSpace': string;
  
  'nextoreWorkspace.currentUnknown': string;
  
  'nextoreWorkspace.mine': string;
  
  'nextoreWorkspace.teams': string;
  'projectSpace.personal': string;
  'projectSpace.team': string;
  'projectSpace.shared': string;
  
  'nextoreWorkspace.createHint': string;
  
  'nextoreWorkspace.switched': string;
  
  'nextoreTeam.roleForGroup': string;
  
  'nextoreTeam.selectedCount': string;
  
  'nextoreShared.title': string;
  
  'nextoreTeam.createAction': string;
  
  'nextoreTeam.dialogTitle': string;
  
  'nextoreTeam.nameLabel': string;
  
  'nextoreTeam.namePlaceholder': string;
  
  'nextoreTeam.groupsLabel': string;
  
  'nextoreTeam.roleManager': string;
  
  'nextoreTeam.roleEditor': string;
  
  'nextoreTeam.roleReader': string;
  
  'nextoreTeam.submit': string;
  
  'nextoreTeam.creating': string;
  
  'nextoreTeam.error': string;
  
  'nextoreTeam.noGroups': string;
  
  'nextoreTeam.searchGroups': string;
  
  'nextoreTeam.truncated': string;
  
  'nextoreTeam.noMatches': string;
  
  'home.noCreateTitle': string;
  
  'home.noCreateBody': string;
  
  'chat.lockedTitle': string;
  
  'chat.lockedBody': string;
  
  'chat.lockedHint': string;
  
  'workspace.projectQuarantined': string;
  
  'nextore.share.subtitle': string;
  
  'nextore.share.expiry': string;
  
  'nextore.share.never': string;
  
  'nextore.share.days': string;
  
  'nextore.share.empty': string;
  
  'nextore.share.loadFailed': string;
  
  'nextore.share.confirmRevoke': string;
  'nextore.artifact.status.loading': string;
  'nextore.artifact.status.notPublished': string;
  'nextore.artifact.status.publishing': string;
  'nextore.artifact.status.published': string;
  'nextore.artifact.status.failed': string;
  'nextore.artifact.status.missing': string;
  'nextore.artifact.status.unavailable': string;
  'nextore.artifact.retry': string;
  'nextore.artifact.retrying': string;
  'nextore.artifact.reason.auth_required': string;
  'nextore.artifact.reason.snapshot_unavailable': string;
  'nextore.artifact.reason.versioning_required': string;
  'nextore.artifact.reason.share_forbidden': string;
  'nextore.artifact.reason.folder_share_forbidden': string;
  'nextore.artifact.reason.nextore_unavailable': string;
  'nextore.artifact.reason.pin_version_unsupported': string;
  'nextore.artifact.share.title': string;
  'nextore.artifact.share.representation': string;
  'nextore.artifact.share.snapshot': string;
  'nextore.artifact.share.source': string;
  'nextore.artifact.share.previewOnly': string;
  'nextore.artifact.share.expiry': string;
  'nextore.artifact.share.never': string;
  'nextore.artifact.share.days': string;
  'nextore.artifact.share.password': string;
  'nextore.artifact.share.create': string;
  'nextore.artifact.share.creating': string;
  'nextore.artifact.share.link': string;
  'nextore.artifact.share.copy': string;
  'nextore.artifact.share.copied': string;
  'nextore.artifact.share.copyFailed': string;
  'nextore.artifact.share.revoke': string;
  'nextore.artifact.share.failed': string;
  'nextore.artifact.share.pinUnavailable': string;
  'nextore.artifact.dialog.title': string;
  'nextore.artifact.download': string;
  'nextore.artifact.downloadUnavailable': string;
  'nextore.artifact.legacy.expired': string;
  'nextore.artifact.legacy.never': string;
  'nextore.artifact.legacy.expiresIn': string;
}
