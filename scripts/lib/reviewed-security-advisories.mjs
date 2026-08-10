import { createHash } from 'node:crypto'

const PRODUCT_PREFIX = Object.freeze({
  vbr: 'vbr',
  'enterprise-manager': 'em',
  vro: 'vro',
})

const unsupportedVersionsCondition = 'Veeam states that unsupported product versions are not tested but are likely affected and should be considered vulnerable.'
const optionalEnterpriseManagerCondition = 'Veeam documents this issue for the optional Veeam Backup Enterprise Manager component. Verify that Enterprise Manager is deployed; this does not downgrade the upgrade reason.'

const article = (articleId, productId, title, details) => ({
  articleId,
  productId,
  source: {
    id: articleId,
    title,
    url: `https://www.veeam.com/${articleId}`,
  },
  ...details,
})

const vbr4693Records = [
  ['CVE-2024-40717', 'An authenticated user with a role assigned on the backup server can execute a pre-job or post-job script as LocalSystem.', 8.8],
  ['CVE-2024-42451', 'An authenticated user with a role assigned on the backup server can access all saved credentials in a human-readable format.', 7.7],
  ['CVE-2024-42452', 'An authenticated user with a role assigned on the backup server can remotely upload files to connected ESXi hosts with elevated privileges.', 8.8],
  ['CVE-2024-42453', 'An authenticated user with a role assigned on the backup server can control and modify the configuration of connected virtual infrastructure hosts.', 8.8],
  ['CVE-2024-42455', 'An authenticated user with a role assigned on the backup server can exploit insecure deserialization to delete files with service-account privileges.', 7.1],
  ['CVE-2024-42456', 'An authenticated user with a role assigned on the backup server can access privileged methods and control critical services.', 8.8],
  ['CVE-2024-42457', 'An authenticated user with certain operator roles can expose saved credentials through the remote management interface.', 7.7],
  ['CVE-2024-45204', 'An authenticated user with an assigned role can exploit insufficient credential-handling permissions and potentially leak saved-credential NTLM hashes.', 7.7],
].map(([cve, title, cvssScore]) => ({ cve, title, cvssScore }))

export const REVIEWED_SECURITY_ADVISORIES = Object.freeze([
  article('kb4771', 'vbr', 'Veeam KB4771: Vulnerabilities Resolved in Veeam Backup & Replication 12.3.2.4165 Patch', {
    affectedBuildRanges: [{ versionPrefix: '12.', throughBuild: '12.3.2.3617' }],
    fixedReleaseId: 'vbr-12.3.2.4165',
    records: [
      {
        cve: 'CVE-2025-48983',
        title: 'A vulnerability in the Mount service allows an authenticated domain user to execute code remotely on backup infrastructure hosts.',
        cvssScore: 9.9,
        conditions: ['This issue affects domain-joined Veeam Backup & Replication v12 backup infrastructure servers. Veeam states that non-domain-joined hosts and the Veeam Software Appliance are not affected.', unsupportedVersionsCondition],
      },
      {
        cve: 'CVE-2025-48984',
        title: 'A vulnerability allows an authenticated domain user to execute code remotely on the backup server.',
        cvssScore: 9.9,
        conditions: ['This issue affects domain-joined Veeam Backup & Replication v12 backup servers. Veeam states that non-domain-joined servers and the Veeam Software Appliance are not affected.', unsupportedVersionsCondition],
      },
    ],
  }),
  article('kb4743', 'vbr', 'Veeam KB4743: Vulnerabilities Resolved in Veeam Backup & Replication 12.3.2', {
    affectedBuildRanges: [{ versionPrefix: '12.', throughBuild: '12.3.1.1139' }],
    fixedReleaseId: 'vbr-12.3.2.3617',
    records: [
      {
        cve: 'CVE-2025-23121',
        title: 'A vulnerability allows an authenticated domain user to execute code remotely on the backup server.',
        cvssScore: 9.9,
        conditions: ['This issue affects domain-joined backup servers.', unsupportedVersionsCondition],
      },
      {
        cve: 'CVE-2025-24286',
        title: 'An authenticated Backup Operator can modify backup jobs in a way that executes arbitrary code.',
        cvssScore: 7.2,
        conditions: [unsupportedVersionsCondition],
      },
    ],
  }),
  article('kb4724', 'vbr', 'Veeam KB4724: CVE-2025-23120', {
    affectedBuildRanges: [{ versionPrefix: '12.', throughBuild: '12.3.0.310' }],
    fixedReleaseId: 'vbr-build-12-3-1-1139',
    records: [{
      cve: 'CVE-2025-23120',
      title: 'A vulnerability allows an authenticated domain user to execute code remotely on the backup server.',
      cvssScore: 9.9,
      conditions: ['This issue affects domain-joined backup servers. KB4724 also offers a build-specific hotfix for 12.3.0.310; verify its file hashes if using that remediation.', unsupportedVersionsCondition],
    }],
  }),
  article('kb4424', 'vbr', 'Veeam KB4424: CVE-2023-27532', {
    affectedVersionPrefixes: ['5.', '6.', '7.', '8.', '9.', '10.', '11.', '12.0.'],
    remediation: 'Install Veeam Backup & Replication 12.0.0.1420 P20230223 or 11.0.1.1261 P20230227. Earlier versions must first be upgraded to a supported version.',
    records: [{
      cve: 'CVE-2023-27532',
      title: 'An unauthenticated user inside the backup infrastructure network perimeter can obtain encrypted credentials from the configuration database.',
      cvssScore: 7.5,
      conditions: ['The vulnerable Veeam Backup Service listens on TCP 9401 by default. Patch-level verification is required because the fixed 11a and 12 builds retain their base build numbers.'],
    }],
  }),
  article('kb4290', 'vbr', 'Veeam KB4290: CVE-2022-26504', {
    affectedVersionPrefixes: ['9.5.', '10.', '11.'],
    remediation: 'Install Veeam Backup & Replication 11.0.1.1261 P20220302 or 10.0.1.4854 P20220304. Veeam Backup & Replication 9.5 must be upgraded to a supported version.',
    records: [{
      cve: 'CVE-2022-26504',
      title: 'A domain user can execute malicious code remotely through the Microsoft SCVMM integration component.',
      cvssScore: 8.8,
      conditions: ['The default installation is not affected; an SCVMM server must be registered. Patch-level verification is required because the fixed 10a and 11a builds retain their base build numbers.'],
    }],
  }),
  article('kb4288', 'vbr', 'Veeam KB4288: CVE-2022-26500 and CVE-2022-26501', {
    affectedVersionPrefixes: ['9.5.', '10.', '11.'],
    remediation: 'Install Veeam Backup & Replication 11.0.1.1261 P20220302 or 10.0.1.4854 P20220304. Veeam Backup & Replication 9.5 must be upgraded to a supported version. Stopping and disabling the Veeam Distribution Service is only a temporary mitigation.',
    conditions: ['The vulnerable Veeam Distribution Service listens on TCP 9380 by default. Patch-level verification is required because the fixed 10a and 11a builds retain their base build numbers.'],
    records: [
      { cve: 'CVE-2022-26500', title: 'An unauthenticated attacker can execute malicious code remotely through internal Veeam Distribution Service API functions.', cvssScore: 9.8 },
      { cve: 'CVE-2022-26501', title: 'An unauthenticated attacker can execute malicious code remotely through internal Veeam Distribution Service API functions.', cvssScore: 9.8 },
    ],
  }),
  article('kb2662', 'vbr', 'Veeam KB2662: Zip Slip Vulnerability', {
    affectedBuildRanges: [
      { versionPrefix: '8.', throughBuild: '8.0.0.2084' },
      { versionPrefix: '9.', throughBuild: '9.5.0.1536' },
    ],
    remediation: 'Apply the KB2662 hotfix for Veeam Backup & Replication 8 Update 3, 9.0 Update 2, 9.5 Update 2, or 9.5 Update 3. The fix is included in 9.5 Update 3a.',
    records: [{
      cve: 'CVE-2018-1002205',
      title: 'The DotNetZip Zip Slip vulnerability permits arbitrary file overwrite through path-traversal filenames during guest file system indexing.',
      conditions: ['Veeam documents guest file system indexing as the only known attack path. Veeam does not publish a CVSS score in KB2662.'],
    }],
  }),
  article('kb2180', 'vbr', 'Veeam KB2180: Veeam Backup & Replication Local Privilege Escalation Vulnerability', {
    affectedVersionPrefixes: ['6.', '7.'],
    affectedBuildRanges: [{ versionPrefix: '8.', throughBuild: '8.0.0.2029' }],
    fixedReleaseId: 'vbr-build-8-0-0-2084',
    records: [{
      cve: 'CVE-2015-5742',
      title: 'A low-privileged local Windows user can read Veeam Backup logs and recover the password used to run privileged Veeam components.',
      conditions: ['KB2180 publishes the malformed identifier CVE20155742; it is canonicalized to CVE-2015-5742. Veeam does not publish a CVSS score in the article. Updating to Veeam Backup & Replication 9.x is also a documented solution.'],
    }],
  }),
  article('kb3103', 'vbr', 'Veeam KB3103: List of Security Fixes and Improvements in Veeam Backup & Replication', {
    affectedVersionPrefixes: ['10.', '11.0.0.'],
    remediation: 'Install Veeam Backup & Replication 11.0.0.837 P20210507 or 10.0.1.4854 P20210609, or a later release containing those fixes.',
    records: [{
      cve: 'CVE-2021-35971',
      title: 'A vulnerability in Microsoft .NET remoting deserialization logic was fixed.',
      conditions: ['KB3103 is the only Veeam advisory source for this catalog finding and does not publish a CVSS score or a separate affected-build statement. Verify the installed patch date because the fixed builds retain their base build numbers.'],
    }],
  }),
  article('kb4879', 'vbr', 'Veeam KB4879: Veeam Software Appliance and Veeam Infrastructure Appliance Updater Component Vulnerability', {
    affectedVersionPrefixes: ['13.'],
    remediation: 'Update the Veeam Updater component to version 12.3.0.65 or later. Automatic update is expected for connected appliances; otherwise arrange a manual update with Veeam Support and verify the component version in the Host Management Console.',
    records: [{
      key: 'updater-component-privilege-escalation',
      title: 'A local user can elevate privileges through the Veeam Updater component and gain root-level access to the appliance operating system.',
      cvssScore: 8.4,
      conditions: ['This issue affects the Veeam Software Appliance and Veeam Infrastructure Appliance. Windows-based backup servers are not affected, although remote appliance components may be. No CVE is assigned in KB4879.'],
    }],
  }),
  article('kb4491', 'vbr', 'Veeam KB4491: Security Issue in Microsoft Azure Plug-In for Veeam Backup & Replication', {
    affectedVersionPrefixes: ['12.'],
    remediation: 'Upgrade Microsoft Azure Plug-In for Veeam Backup & Replication from 12.1.5.99 to 12.1.5.106, then rotate the appliance administrator password in Veeam Backup for Microsoft Azure and Veeam Backup & Replication.',
    records: [{
      key: 'azure-plugin-credential-disclosure',
      title: 'The Microsoft Azure plug-in can expose a Veeam Backup for Microsoft Azure appliance administrator password in an updater log.',
      conditions: ['This issue applies when an Azure appliance was upgraded to version 5a using Microsoft Azure Plug-In 12.1.5.99. KB4491 does not assign a CVE or publish a CVSS score.'],
    }],
  }),
  article('kb4682', 'enterprise-manager', 'Veeam KB4682: Veeam Backup Enterprise Manager Vulnerability (CVE-2024-40715)', {
    affectedVersionPrefixes: ['10.', '11.', '12.0.', '12.1.', '12.2.'],
    remediation: 'Upgrade Veeam Backup Enterprise Manager 12.1.2.172 or earlier to 12.2.0.334 using the repackaged ISO, or apply the KB4682 hotfix to an existing 12.2.0.334 deployment.',
    records: [{
      cve: 'CVE-2024-40715',
      title: 'An attacker performing a man-in-the-middle attack can bypass Veeam Backup Enterprise Manager authentication.',
      cvssScore: 7.7,
      conditions: [optionalEnterpriseManagerCondition, 'The 12.2.0.334 hotfix does not establish a distinct product build in the catalog; verify hotfix deployment.'],
    }],
  }),
  article('kb4508', 'vro', 'Veeam KB4508: CVE-2023-38547, CVE-2023-38548, CVE-2023-38549, and CVE-2023-41723', {
    affectedVersionPrefixes: ['4.', '5.', '6.'],
    remediation: 'Apply the KB4508 hotfix matching the embedded Veeam ONE build. Veeam Recovery Orchestrator 6 GA must first be updated to VRO 6 P20230419 so its embedded Veeam ONE build is 12.0.1.2591.',
    conditions: ['Veeam Recovery Orchestrator embeds Veeam ONE. VRO 7 is not affected because it uses Veeam ONE 12.1. Verify the embedded Veeam ONE build and hotfix files.'],
    records: [
      { cve: 'CVE-2023-38547', title: 'The embedded Veeam ONE component can disclose SQL connection information to an unauthenticated user, potentially leading to code execution on its configuration database server.', cvssScore: 9.9 },
      { cve: 'CVE-2023-38548', title: 'An unprivileged embedded Veeam ONE Web Client user can acquire the NTLM hash of the Veeam ONE Reporting Service account.', cvssScore: 9.8 },
      { cve: 'CVE-2023-38549', title: 'An embedded Veeam ONE Power User can use cross-site scripting to obtain an administrator access token.', cvssScore: 4.5 },
      { cve: 'CVE-2023-41723', title: 'An embedded Veeam ONE Read-Only User can view the Dashboard Schedule.', cvssScore: 4.3 },
    ],
  }),
  article('kb4693', 'vbr', 'Veeam KB4693: Vulnerabilities Resolved in Veeam Backup & Replication 12.3', {
    affectedBuildRanges: [{ versionPrefix: '12.', throughBuild: '12.2.0.334' }],
    fixedReleaseId: 'vbr-build-12-3-0-310',
    conditions: [unsupportedVersionsCondition],
    records: vbr4693Records,
  }),
  article('kb4852', 'vbr', 'Veeam KB4852: Vulnerabilities Resolved in Veeam Backup & Replication 13.0.2', {
    affectedBuildRanges: [{ versionPrefix: '13.', throughBuild: '13.0.1.2067' }],
    fixedReleaseId: 'vbr-13.0.2',
    records: [{
      cve: 'CVE-2026-32997',
      title: 'An authenticated Backup Administrator can write arbitrary files on a Linux-based Veeam Backup & Replication server.',
      cvssScore: 8.6,
      conditions: ['Veeam lists the affected deployment type as Veeam Software Appliance.'],
    }],
  }),
  article('kb4581', 'enterprise-manager', 'Veeam KB4581: Veeam Backup Enterprise Manager Vulnerabilities', {
    affectedVersionPrefixes: ['5.', '6.', '7.', '8.', '9.', '10', '11', '12.0.', '12.1.'],
    fixedReleaseId: 'em-12.1.2.172',
    conditions: [optionalEnterpriseManagerCondition],
    records: [
      { cve: 'CVE-2024-29849', title: 'An unauthenticated attacker can sign in to the Enterprise Manager web interface as any user.', cvssScore: 9.8 },
      { cve: 'CVE-2024-29850', title: 'An attacker can take over an Enterprise Manager account through NTLM relay.', cvssScore: 8.8 },
      { cve: 'CVE-2024-29851', title: 'A high-privileged user can steal the Enterprise Manager service account NTLM hash when the service does not run as Local System.', cvssScore: 7.2 },
      { cve: 'CVE-2024-29852', title: 'A high-privileged user can read backup session logs.', cvssScore: 2.7 },
    ],
  }),
  article('kb4541', 'vro', 'Veeam KB4541: Veeam Recovery Orchestrator Vulnerabilities', {
    affectedReleaseIds: ['vro-build-6-0-0-3516'],
    affectedVersionPrefixes: ['4.', '5.'],
    fixedReleaseId: 'vro-build-7-0-0-337',
    conditions: ['Veeam identifies VRO 6, Disaster Recovery Orchestrator 5, and Availability Orchestrator 4 as affected. VRO 7 is not affected.'],
    records: [
      { cve: 'CVE-2024-22021', title: 'A low-privileged Plan Author can retrieve plans outside their assigned scope.', cvssScore: 4.5 },
      { cve: 'CVE-2024-22022', title: 'A low-privileged Orchestrator user can access the service account NTLM hash.', cvssScore: 8.8 },
    ],
  }),
  article('kb4585', 'vro', 'Veeam KB4585: Veeam Recovery Orchestrator Vulnerability (CVE-2024-29855)', {
    affectedReleaseIds: ['vro-build-7-0-0-337', 'vro-build-7-1-0-205'],
    fixedReleaseId: 'vro-7.1.0.230',
    records: [{
      cve: 'CVE-2024-29855',
      title: 'An attacker can access the Veeam Recovery Orchestrator web interface with administrative privileges.',
      cvssScore: 9,
      conditions: ['The attacker must know the exact username and role of an account with an active VRO UI access token. Verify this precondition; it does not downgrade the critical upgrade reason.'],
    }],
  }),
])

const kb3103IgnoredCves = Object.freeze([
  'CVE-2022-26500', 'CVE-2022-26501', 'CVE-2022-26503', 'CVE-2022-26504', 'CVE-2023-27532', 'CVE-2023-38545',
  'CVE-2024-29849', 'CVE-2024-29850', 'CVE-2024-29851', 'CVE-2024-29852', 'CVE-2024-39718', 'CVE-2024-40710',
  'CVE-2024-40711', 'CVE-2024-40712', 'CVE-2024-40713', 'CVE-2024-40714', 'CVE-2024-40717', 'CVE-2024-42451',
  'CVE-2024-42452', 'CVE-2024-42453', 'CVE-2024-42455', 'CVE-2024-42456', 'CVE-2024-42457', 'CVE-2024-45204',
  'CVE-2025-23120', 'CVE-2025-23121', 'CVE-2025-24286', 'CVE-2025-48983', 'CVE-2025-48984', 'CVE-2025-55125',
  'CVE-2025-59468', 'CVE-2025-59469', 'CVE-2025-59470', 'CVE-2026-21666', 'CVE-2026-21667', 'CVE-2026-21668',
  'CVE-2026-21669', 'CVE-2026-21670', 'CVE-2026-21671', 'CVE-2026-21672', 'CVE-2026-21708', 'CVE-2026-32997',
  'CVE-2026-44963',
])

const observationSpecs = Object.freeze({
  kb4771: { classification: 'dedicated', productCves: { vbr: ['CVE-2025-48983', 'CVE-2025-48984'] }, ignoredCveIds: ['CVE-2025-48982'] },
  kb4743: { classification: 'dedicated', productCves: { vbr: ['CVE-2025-23121', 'CVE-2025-24286'] }, ignoredCveIds: ['CVE-2025-24287'] },
  kb4724: { classification: 'dedicated', productCves: { vbr: ['CVE-2025-23120'] } },
  kb4424: { classification: 'dedicated', productCves: { vbr: ['CVE-2023-27532'] }, ignoredCveIds: ['CVE-2023-27530'] },
  kb4290: { classification: 'dedicated', productCves: { vbr: ['CVE-2022-26504'] } },
  kb4288: { classification: 'dedicated', productCves: { vbr: ['CVE-2022-26500', 'CVE-2022-26501'] } },
  kb2662: { classification: 'dedicated', productCves: { vbr: ['CVE-2018-1002205'] } },
  kb2180: { classification: 'dedicated', productCves: { vbr: ['CVE-2015-5742'] } },
  kb3103: { classification: 'inventory', productCves: { vbr: ['CVE-2021-35971'] }, ignoredCveIds: kb3103IgnoredCves },
  kb4879: { classification: 'dedicated', productCves: { vbr: [] }, allowNoCves: true },
  kb4491: { classification: 'dedicated', productCves: { vbr: [] }, allowNoCves: true },
  kb4682: { classification: 'dedicated', productCves: { 'enterprise-manager': ['CVE-2024-40715'] } },
  kb4508: {
    classification: 'dedicated',
    productCves: {
      'veeam-one': ['CVE-2023-38547', 'CVE-2023-38548', 'CVE-2023-38549', 'CVE-2023-41723'],
      vro: ['CVE-2023-38547', 'CVE-2023-38548', 'CVE-2023-38549', 'CVE-2023-41723'],
    },
    multiProduct: true,
  },
  kb4649: {
    classification: 'dedicated',
    productCves: {
      vbr: ['CVE-2024-39718', 'CVE-2024-40710', 'CVE-2024-40711', 'CVE-2024-40712', 'CVE-2024-40713', 'CVE-2024-40714'],
      'veeam-one': ['CVE-2024-42019', 'CVE-2024-42020', 'CVE-2024-42021', 'CVE-2024-42022', 'CVE-2024-42023', 'CVE-2024-42024'],
      vspc: ['CVE-2024-38650', 'CVE-2024-38651', 'CVE-2024-39714', 'CVE-2024-39715', 'CVE-2024-45206'],
    },
    ignoredCveIds: ['CVE-2024-40709', 'CVE-2024-40718'],
    multiProduct: true,
  },
  kb4693: { classification: 'dedicated', productCves: { vbr: vbr4693Records.map((record) => record.cve) }, ignoredCveIds: ['CVE-2024-45207'] },
  kb4852: { classification: 'dedicated', productCves: { vbr: ['CVE-2026-32997'] }, ignoredCveIds: ['CVE-2026-32996'] },
  kb4581: { classification: 'dedicated', productCves: { 'enterprise-manager': ['CVE-2024-29849', 'CVE-2024-29850', 'CVE-2024-29851', 'CVE-2024-29852'] } },
  kb4541: { classification: 'dedicated', productCves: { vro: ['CVE-2024-22021', 'CVE-2024-22022'] } },
  kb4585: { classification: 'dedicated', productCves: { vro: ['CVE-2024-29855'] } },
  kb4163: {
    classification: 'informational', productCves: { vspc: [] }, allowNoCves: true,
    informationalReason: 'SUPERSEDED_BY_TRACKED_ADVISORY',
    contentFingerprint: 'sha256:7f9ec10ab9104ee413a3ac5e2663008fbe8e7d04a5a2d0ca0761e06095d9f650',
  },
  kb4231: {
    classification: 'informational', productCves: { vbr: [] }, ignoredCveIds: ['CVE-2021-36934'],
    informationalReason: 'NO_VENDOR_VULNERABILITY_FINDING',
    contentFingerprint: 'sha256:683a089eebe8e9d0c87617f88a12d607b56074219a0105eef61437d21667670c',
  },
  kb4254: {
    classification: 'informational',
    productCves: { vbr: [], 'enterprise-manager': [], 'veeam-one': [], vro: [], vspc: [], vb365: [] },
    ignoredCveIds: ['CVE-2021-21985', 'CVE-2021-44228'], multiProduct: true,
    informationalReason: 'NO_VENDOR_VULNERABILITY_FINDING',
    contentFingerprint: 'sha256:07fd1d4c016859cd8dacc2f1046ca7ee8a6297bf3a7de27c47646e40640708d3',
  },
  kb4233: {
    classification: 'informational',
    productCves: { vbr: [], 'enterprise-manager': [], 'veeam-one': [], vro: [], vspc: [], vb365: [] },
    allowNoCves: true, multiProduct: true,
    informationalReason: 'NO_VENDOR_VULNERABILITY_FINDING',
    contentFingerprint: 'sha256:c642a2dc79645c533c3aa4fab5ed7e123bb0c18042b223a91a2f84562fbd0323',
  },
  kb4857: {
    classification: 'informational', productCves: { vro: [] }, allowNoCves: true,
    informationalReason: 'NO_VENDOR_VULNERABILITY_FINDING',
    contentFingerprint: 'sha256:8776ca729c1c40ad24d8b975d5dcd74e3b3fab2672bd2bf80089f31db28d3b7e',
  },
  kb4712: {
    classification: 'informational', productCves: { vbr: [] }, ignoredCveIds: ['CVE-2025-23114'],
    informationalReason: 'UNTRACKED_MANAGED_COMPONENT',
    contentFingerprint: 'sha256:79b149d9e0e1d6368e066c2e6b6399ba0a164dac5a006c85e89434c1eeb87430',
  },
  kb4709: {
    classification: 'informational', productCves: { vbr: [] }, ignoredCveIds: ['CVE-2025-23082'],
    informationalReason: 'UNTRACKED_MANAGED_COMPONENT',
    contentFingerprint: 'sha256:a096adba278170536471bb4b3c05582d7e75a97e08dd5a79f70e4049b6d593ad',
  },
})

const sortedUnique = (values) => [...new Set(values)].sort()

function decodeSemanticHtml(value) {
  const named = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity
    const numeric = code[1].toLowerCase() === 'x'
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10)
    return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity
  })
}

export function normalizeReviewedSecurityMainArticle(content) {
  if (typeof content !== 'string') throw new TypeError('Reviewed security article content must be a string.')
  const heading = content.search(/<h1\b/i)
  let scoped = heading >= 0 ? content.slice(heading) : content
  scoped = scoped
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|form|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(?:h[1-6]|p|li|div|section|article|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  let text = decodeSemanticHtml(scoped)
    .replace(/\r/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim()

  const endMarkers = [
    '\nThank you!',
    '\nKB Feedback/Suggestion',
    '\nSpelling error in text',
    '\nIf this KB article did not resolve this issue',
    '\nIf this KB article did not resolve your issue',
  ]
  const end = endMarkers.map((marker) => text.indexOf(marker)).filter((index) => index >= 0).sort((left, right) => left - right)[0]
  if (end !== undefined) text = text.slice(0, end)

  return text
    .replace(/\nGet weekly article updates[\s\S]*?\n(?:Veeam Software Security Commitment|General Vulnerability Details|Challenge|Issue Details|Purpose)\n/i, (match) => `\n${match.trim().split('\n').at(-1)}\n`)
    .replace(/\s+/g, ' ')
    .trim()
}

export function fingerprintReviewedSecurityMainArticle(content) {
  return `sha256:${createHash('sha256').update(normalizeReviewedSecurityMainArticle(content)).digest('hex')}`
}

export const REVIEWED_SECURITY_OBSERVATION_POLICY = Object.freeze(Object.fromEntries(
  Object.entries(observationSpecs).map(([articleId, spec]) => [articleId, Object.freeze({
    classification: spec.classification,
    productIds: Object.freeze(Object.keys(spec.productCves)),
    expectedCveIds: Object.freeze(sortedUnique([...Object.values(spec.productCves).flat(), ...(spec.ignoredCveIds ?? [])])),
    ignoredCveIds: Object.freeze(sortedUnique(spec.ignoredCveIds ?? [])),
    allowNoCves: spec.allowNoCves === true,
    multiProduct: spec.multiProduct === true,
    ...(spec.informationalReason ? { informationalReason: spec.informationalReason, contentFingerprint: spec.contentFingerprint } : {}),
    productCves: Object.freeze(Object.fromEntries(Object.entries(spec.productCves).map(([productId, cves]) => [productId, Object.freeze(sortedUnique(cves))]))),
  })]),
))

export const REVIEWED_SECURITY_CLASSIFICATIONS = Object.freeze(Object.fromEntries(
  Object.entries(REVIEWED_SECURITY_OBSERVATION_POLICY).map(([articleId, policy]) => [articleId, Object.freeze({
    classification: policy.classification,
    productIds: policy.productIds,
    ignoredCveIds: policy.ignoredCveIds,
    allowNoCves: policy.allowNoCves,
    multiProduct: policy.multiProduct,
    ...(policy.informationalReason ? { informationalReason: policy.informationalReason, contentFingerprint: policy.contentFingerprint } : {}),
  })]),
))

const advisoryCoverage = REVIEWED_SECURITY_ADVISORIES.map((advisory) => Object.freeze({
  articleId: advisory.articleId,
  productId: advisory.productId,
  cveIds: Object.freeze(advisory.records.flatMap((record) => record.cve ? [record.cve] : [])),
}))

export const REVIEWED_SECURITY_PARSED_COVERAGE = Object.freeze([
  ...advisoryCoverage,
  Object.freeze({ articleId: 'kb4857', productId: 'vro', cveIds: Object.freeze([]) }),
])

export const REVIEWED_SECURITY_SOURCE_COVERAGE = REVIEWED_SECURITY_PARSED_COVERAGE

export class ReviewedSecurityObservationError extends Error {
  constructor(articleId, missingCveIds, unexpectedCveIds) {
    const missing = missingCveIds.length ? ` missing=${missingCveIds.join(',')}` : ''
    const unexpected = unexpectedCveIds.length ? ` unexpected=${unexpectedCveIds.join(',')}` : ''
    super(`Reviewed security article ${articleId} changed.${missing}${unexpected}`)
    this.name = 'ReviewedSecurityObservationError'
    this.code = 'REVIEWED_SECURITY_ARTICLE_CHANGED'
    this.articleId = articleId
    this.missingCveIds = missingCveIds
    this.unexpectedCveIds = unexpectedCveIds
  }
}

export function extractReviewedSecurityCveIds(content) {
  if (typeof content !== 'string') throw new TypeError('Reviewed security article content must be a string.')
  return sortedUnique([...content.matchAll(/\bCVE\s*-?\s*(\d{4})\s*-?\s*(\d{4,7})\b/gi)]
    .map((match) => `CVE-${match[1]}-${match[2]}`))
}

export function observeReviewedSecurityArticle(articleId, content) {
  const normalizedArticleId = String(articleId).toLowerCase()
  const policy = REVIEWED_SECURITY_OBSERVATION_POLICY[normalizedArticleId]
  if (!policy) throw new ReviewedSecurityObservationError(normalizedArticleId, [], [])

  const observedCves = extractReviewedSecurityCveIds(content)
  const missingCveIds = policy.expectedCveIds.filter((cve) => !observedCves.includes(cve))
  const unexpectedCveIds = observedCves.filter((cve) => !policy.expectedCveIds.includes(cve))
  const fingerprintChanged = policy.contentFingerprint
    ? fingerprintReviewedSecurityMainArticle(content) !== policy.contentFingerprint
    : false
  if (missingCveIds.length || unexpectedCveIds.length || fingerprintChanged) {
    throw new ReviewedSecurityObservationError(normalizedArticleId, missingCveIds, unexpectedCveIds)
  }

  return {
    observedCves,
    ...(policy.multiProduct ? { observedCvesByProduct: structuredClone(policy.productCves) } : {}),
  }
}

function findingFor(advisory, record, previousFinding) {
  const idPrefix = PRODUCT_PREFIX[advisory.productId]
  if (!idPrefix) throw new Error(`Unsupported reviewed security product: ${advisory.productId}`)
  const id = record.cve
    ? `${idPrefix}-${record.cve.toLowerCase()}`
    : `${idPrefix}-${advisory.articleId}-${record.key}`
  const conditions = [...(advisory.conditions ?? []), ...(record.conditions ?? [])]
  const sourceIds = [advisory.articleId]
  if (previousFinding?.isCisaKev && previousFinding.sourceIds?.includes('cisa-kev')) sourceIds.push('cisa-kev')

  return {
    id,
    productId: advisory.productId,
    title: record.title,
    cves: record.cve ? [record.cve] : [],
    affectedReleaseIds: [...(record.affectedReleaseIds ?? advisory.affectedReleaseIds ?? [])],
    ...(record.affectedVersionPrefixes ?? advisory.affectedVersionPrefixes ? { affectedVersionPrefixes: [...(record.affectedVersionPrefixes ?? advisory.affectedVersionPrefixes)] } : {}),
    ...(record.affectedBuildRanges ?? advisory.affectedBuildRanges ? { affectedBuildRanges: structuredClone(record.affectedBuildRanges ?? advisory.affectedBuildRanges) } : {}),
    ...(record.fixedReleaseId ?? advisory.fixedReleaseId ? { fixedReleaseId: record.fixedReleaseId ?? advisory.fixedReleaseId } : {}),
    ...(record.remediation ?? advisory.remediation ? { remediation: record.remediation ?? advisory.remediation } : {}),
    ...(Number.isFinite(record.cvssScore) ? { cvssScore: record.cvssScore } : {}),
    isCisaKev: previousFinding?.isCisaKev === true,
    conditions,
    sourceIds,
  }
}

export function mergeReviewedSecurityAdvisories(catalog, { checkedAt } = {}) {
  if (!catalog || !Array.isArray(catalog.securityFindings)) throw new TypeError('Catalog must include a securityFindings array.')
  if (catalog.sources !== undefined && !Array.isArray(catalog.sources)) throw new TypeError('Catalog sources must be an array when provided.')
  const next = structuredClone(catalog)
  next.sources ??= []

  const reviewedPairs = new Set(REVIEWED_SECURITY_ADVISORIES.map((advisory) => `${advisory.productId}:${advisory.articleId}`))
  const previousById = new Map(next.securityFindings.map((finding) => [finding.id, finding]))
  const retained = next.securityFindings.filter((finding) =>
    !(finding.sourceIds ?? []).some((sourceId) => reviewedPairs.has(`${finding.productId}:${sourceId}`)),
  )

  const findings = REVIEWED_SECURITY_ADVISORIES.flatMap((advisory) =>
    advisory.records.map((record) => findingFor(advisory, record, previousById.get(record.cve
      ? `${PRODUCT_PREFIX[advisory.productId]}-${record.cve.toLowerCase()}`
      : `${PRODUCT_PREFIX[advisory.productId]}-${advisory.articleId}-${record.key}`))),
  )
  const findingIds = findings.map((finding) => finding.id)
  if (new Set(findingIds).size !== findingIds.length) throw new Error('Reviewed security advisories produced duplicate finding IDs.')

  const releaseById = new Map((next.releases ?? []).map((release) => [release.id, release]))
  for (const finding of findings) {
    for (const releaseId of [...finding.affectedReleaseIds, ...(finding.fixedReleaseId ? [finding.fixedReleaseId] : [])]) {
      const release = releaseById.get(releaseId)
      if (!release || release.productId !== finding.productId) throw new Error(`${finding.id} references missing or cross-product release ${releaseId}.`)
    }
  }

  let sourceChanges = 0
  for (const advisory of REVIEWED_SECURITY_ADVISORIES) {
    const existingIndex = next.sources.findIndex((source) => source.id === advisory.source.id)
    const source = {
      ...(existingIndex >= 0 ? next.sources[existingIndex] : {}),
      ...advisory.source,
      ...(checkedAt ? { checkedAt } : {}),
    }
    if (existingIndex >= 0) next.sources[existingIndex] = source
    else next.sources.push(source)
    sourceChanges += 1
  }
  if (!next.sources.some((source) => source.id === 'kb4857')) {
    next.sources.push({
      id: 'kb4857',
      title: 'Veeam KB4857: List of Security Fixes and Improvements in Veeam Recovery Orchestrator',
      url: 'https://www.veeam.com/kb4857',
      ...(checkedAt ? { checkedAt } : {}),
    })
    sourceChanges += 1
  }

  next.securityFindings = [...retained, ...findings]
  return {
    catalog: next,
    findings: findings.length,
    replacedFindings: catalog.securityFindings.length - retained.length,
    sources: sourceChanges,
    parsedCoverage: structuredClone(REVIEWED_SECURITY_PARSED_COVERAGE),
  }
}
