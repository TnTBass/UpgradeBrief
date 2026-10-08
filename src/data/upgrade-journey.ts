// Manually reviewed guidance, separate from the automatically refreshed catalog.
// Review the source wording and route coverage before extending the target release.
export const journeyReviewedAt = '2026-10-07'
export const journeySources = {
  route: { title: 'Supported upgrade paths (KB2053)', url: 'https://www.veeam.com/kb2053' },
  v12: { title: 'Original V12 release notes', url: 'https://www.veeam.com/veeam_backup_12_release_notes_rn.pdf#page=34' },
  rollback: { title: 'Resolve rollback transformation (KB4390)', url: 'https://www.veeam.com/kb4390' },
  retentionChange: { title: 'V12 release notes: retention change', url: 'https://www.veeam.com/veeam_backup_12_release_notes_rn.pdf#page=36' },
  retention: { title: 'V12 background retention and exceptions', url: 'https://helpcenter.veeam.com/archive/backup/120/vsphere/background_retention_job.html' },
  v123: { title: 'V12 upgrade checklist', url: 'https://helpcenter.veeam.com/archive/backup/120/vsphere/upgrade_vbr_byb.html' },
  chain: { title: 'V12 backup-chain formats', url: 'https://helpcenter.veeam.com/archive/backup/120/vsphere/backup_change_type.html' },
  copy: { title: 'V12 backup-copy conversion', url: 'https://helpcenter.veeam.com/archive/backup/120/vsphere/backup_copy_change_type.html' },
  v13: { title: 'V13 upgrade checklist', url: 'https://helpcenter.veeam.com/docs/vbr/userguide/upgrade_vbr_byb.html' },
  agents: { title: 'Supported Veeam Agents', url: 'https://helpcenter.veeam.com/docs/vbr/userguide/agents_supported_veeam_agents.html' },
  after: { title: 'V13 post-upgrade steps', url: 'https://helpcenter.veeam.com/docs/vbr/userguide/upgrade_vbr_after_upgrade.html' },
  methods: { title: 'V13 backup methods', url: 'https://helpcenter.veeam.com/docs/vbr/userguide/backup_methods.html?ver=13' },
  vsa: { title: 'Windows-to-Linux migration (KB4800)', url: 'https://www.veeam.com/kb4800' },
} satisfies Record<string, { title: string; url: string }>

export type JourneySourceId = keyof typeof journeySources
export interface JourneyItem {
  title: string
  text: string
  kind: string
  due: string
  detail: string
  refs: JourneySourceId[]
  tone?: 'required' | 'change'
}

export const journeyItems: Record<string, JourneyItem> = {
  baseline: {
    title: 'Establish a recoverable starting point',
    text: 'Create an encrypted configuration backup, retain its password securely, and confirm recent backups and a representative restore.',
    kind: 'Preparation', due: 'Before the first hop',
    detail: 'Record the current configuration, known issues and recovery procedure before making changes. Take a fresh configuration backup before each subsequent upgrade.', refs: ['v12', 'v13'],
  },
  legacyPlan: {
    title: 'Identify legacy backup chains and copy jobs',
    text: 'If you use older chain formats or copy modes, plan their conversion during V12, before installing V13.',
    kind: 'Plan ahead', due: 'Work to do on V12',
    detail: 'Allow time and capacity for conversion. Address source backups before dependent copy chains. Changing a repository setting alone does not convert existing backups.', refs: ['chain', 'copy'],
  },
  dependencies: {
    title: 'Plan the whole dependency sequence',
    text: 'If you use agents, Enterprise Manager, Veeam ONE or plug-ins, check compatible versions at every hop.',
    kind: 'Compatibility', due: 'Before each hop',
    detail: 'A dependency must work with both the current and next backup-server version. Follow each release checklist when sequencing upgrades.', refs: ['v123', 'v13', 'agents'],
  },
  appliance: {
    title: 'Windows-to-appliance conversion',
    text: 'If you plan a Windows-to-Linux conversion, resolve that route before proceeding to Windows V13.1.',
    kind: 'Route caveat', due: 'Decide before V13.1', tone: 'change',
    detail: 'Current conversion guidance requires a supported, patched V13.0.x deployment and a support-assisted migration. Complete conversion before upgrading to V13.1. The Windows route shown here does not describe that migration.', refs: ['vsa'],
  },
  rollback: {
    title: 'Reconfigure jobs that use rollback transformation',
    text: 'While still on V11, change jobs using “Transform previous backup chains into rollbacks”. These jobs block the V12 upgrade.',
    kind: 'Upgrade blocker', due: 'Before installing V12', tone: 'required',
    detail: 'Use KB4390 to identify affected jobs and choose an alternative retention method. Simply disabling the option can increase repository space usage. This is separate from reverse incremental backup mode.', refs: ['rollback'],
  },
  licensing: {
    title: 'Review licensing changes',
    text: 'If you use Starter, obtain a replacement license. Existing File-to-Tape jobs receive three months of grace after upgrading to V12.',
    kind: 'Licensing', due: 'Review before V12', tone: 'change',
    detail: 'V12 no longer accepts Starter licenses. File-to-Tape becomes licensed; review the vendor terms for the jobs you use.', refs: ['v12'],
  },
  components: {
    title: 'Complete the component work for this hop',
    text: 'If you use Nutanix AHV, complete the required proxy and component upgrade sequence before moving beyond V12.0.',
    kind: 'Compatibility', due: 'After installing V12.0',
    detail: 'KB2053 identifies AHV compatibility as a reason for this intermediate hop. Verify component compatibility, backup operation and retained restore points before proceeding.', refs: ['route', 'v123'],
  },
  conversion: {
    title: 'Resolve legacy backup formats and copy modes',
    text: 'If these remain in use, resolve them on V12 before upgrading to V13. Convert source chains before copy chains, then verify that changed backup and copy jobs run successfully.',
    kind: 'Action required', due: 'Before installing V13', tone: 'required',
    detail: 'Some conversion methods synthesize full backups and need repository space. Converted jobs may remain disabled until manually enabled. Follow the procedure for the actual format, including legacy periodic backup-copy jobs and single-metadata chains.', refs: ['copy', 'chain', 'v13'],
  },
  agentBridge: {
    title: 'Bring managed agents to compatible versions',
    text: 'If you use Windows or Linux Agents, VBR 13.1 on Windows supports older agents from 6.3.1 with limited functionality.',
    kind: 'Compatibility', due: 'Before V13.1',
    detail: 'Use a supported intermediate agent version for the V12 hop, then follow the V13.1 compatibility matrix. Other agent platforms have different minimums.', refs: ['agents', 'v123'],
  },
  database: {
    title: 'Allow for the PostgreSQL installation',
    text: 'V12.3.2 installs a dedicated PostgreSQL instance for Entra ID protection, including on servers using SQL Server.',
    kind: 'Behavior change', due: 'Review before V12.3.2', tone: 'change',
    detail: 'Account for this in change review, capacity planning and software inventory. This does not describe a migration of your existing configuration database.', refs: ['v123'],
  },
  prereqs: {
    title: 'Confirm the final-target prerequisites',
    text: 'Check supported platforms, required ports and PowerShell 7. If you use ONE and Enterprise Manager, follow their upgrade order.',
    kind: 'Action required', due: 'Before installing V13', tone: 'required',
    detail: 'Verify requirements for the exact target build using the complete vendor checklist, including the operating systems and platforms used by backup infrastructure components.', refs: ['v13'],
  },
  removed: {
    title: 'Review workflows discontinued in V13',
    text: 'If you use U-AIR, Cloud Connect Portal, Windows Explorer-launched restores or optical recovery media, plan an alternative.',
    kind: 'Discontinued', due: 'Before installing V13', tone: 'change',
    detail: 'The U-AIR wizard, restoring by double-clicking VBK or VBM files in Windows Explorer, and burning recovery media to CD, DVD or Blu-ray are removed. Veeam Cloud Connect Portal is also discontinued.', refs: ['v13'],
  },
  deprecated: {
    title: 'Review restrictions on new jobs and configurations',
    text: 'V13 restricts new use of reverse incremental backups, restore-point-count retention, single-storage format and Active Directory authentication for Cloud Connect tenants.',
    kind: 'Deprecated', due: 'Before creating new jobs', tone: 'change',
    detail: 'Existing reverse incremental jobs can continue. Review the individual restrictions before replacing jobs or creating tenants; deprecation does not mean every existing configuration stops working.', refs: ['v13', 'methods'],
  },
  processing: {
    title: 'Plan for larger secondary processing',
    text: 'If source jobs run Active Full backups, secondary operations may see one-time full-sized processing after the upgrade.',
    kind: 'Capacity', due: 'Plan before installing V13',
    detail: 'Review the vendor explanation for affected backup-copy, tape and object-storage operations before choosing the maintenance window.', refs: ['v13'],
  },
  finish: {
    title: 'Finish component upgrades and resume protection',
    text: 'Update remote components and consoles; redeploy Virtual Labs if used. Re-enable schedules and verify backups and representative restores.',
    kind: 'After upgrade', due: 'After installing V13',
    detail: 'Outdated remote components cannot run jobs. Check backup copies, integrations and application processing, then take a new encrypted configuration backup.', refs: ['after'],
  },
}
