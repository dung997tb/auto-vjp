/* Auto vjp — module contract data (ported from MUT client task-contract, exports stripped). */
(()=>{
// Ported from MUT core/task-contract.js (CONTRACT_VERSION 2) — see MODULE-CONTRACT.md
const CONTRACT_VERSION = 2;
const TASK_TYPES = Object.freeze({
  "POST": "post",
  "COMMENT": "comment",
  "REPLY": "reply",
  "LIKE": "like",
  "OWN_POST_COMMENT": "own_post_comment",
  "AFFILIATE_COMMENT": "affiliate_comment",
  "AUTO_CONNECT": "auto_connect",
  "JOIN_GROUP": "join_group",
  "SCAN_ACCOUNT": "scan_account",
  "SCAN_GROUP": "scan_group",
  "SCAN_SHOPEE": "scan_shopee",
  "MEDIA_ENRICHMENT": "media_enrichment",
  "AI_CAPTION": "ai_caption",
  "NURTURE": "nurture",
  "STORY": "story",
  "UPLOAD": "upload",
  "HEALTHSCAN": "healthscan"
});
const TASK_STATUS = Object.freeze({
  "PENDING": "pending",
  "PROCESSING": "processing",
  "SUCCESS": "success",
  "FAILED": "failed",
  "CANCELLED": "cancelled",
  "SKIPPED": "skipped",
  "UNCERTAIN": "uncertain"
});
const DELIVERY_STATUS = Object.freeze({
  "CLAIMING": "claiming",
  "READY": "ready",
  "RUNNING": "running",
  "REPORTING": "reporting",
  "COMPLETED": "completed",
  "EXPIRED": "expired",
  "CANCELLED": "cancelled"
});
const FAILURE_CODES = Object.freeze({
  "RATE_LIMITED": "rate_limited",
  "SELECTOR_NOT_FOUND": "selector_not_found",
  "ACCOUNT_MISMATCH": "account_mismatch",
  "UPLOAD_TIMEOUT": "upload_timeout",
  "NETWORK_ERROR": "network_error",
  "TASK_TIMEOUT": "task_timeout",
  "EXECUTION_ERROR": "execution_error",
  "SESSION_EXPIRED": "session_expired",
  "NO_ELIGIBLE_TARGET": "no_eligible_target",
  "USER_CANCELLED": "user_cancelled"
});
const TASK_METADATA = Object.freeze({
  "post": {
    "default_timeout_ms": 1200000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "comment": {
    "default_timeout_ms": 120000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "reply": {
    "default_timeout_ms": 600000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "like": {
    "default_timeout_ms": 30000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "own_post_comment": {
    "default_timeout_ms": 300000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "affiliate_comment": {
    "default_timeout_ms": 900000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "auto_connect": {
    "default_timeout_ms": 600000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "join_group": {
    "default_timeout_ms": 600000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "scan_account": {
    "default_timeout_ms": 300000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "scan_group": {
    "default_timeout_ms": 300000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "scan_shopee": {
    "default_timeout_ms": 300000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "media_enrichment": {
    "default_timeout_ms": 600000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "nurture": {
    "default_timeout_ms": 3600000,
    "retryable_failure_codes": [
      "selector_not_found",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "ai_caption": {
    "default_timeout_ms": 120000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "story": {
    "default_timeout_ms": 1200000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "upload": {
    "default_timeout_ms": 1800000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "healthscan": {
    "default_timeout_ms": 600000,
    "retryable_failure_codes": [
      "selector_not_found",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  }
});
const TERMINAL_TASK_STATUSES = Object.freeze([
  "success",
  "failed",
  "cancelled",
  "skipped",
  "uncertain"
]);
const LEGACY_STATUS_MAP = Object.freeze({
  "completed": "success",
  "published": "success",
  "completed_with_errors": "success",
  "error": "failed",
  "unknown": "uncertain"
});
const LEGACY_FAILURE_CODE_MAP = Object.freeze({
  "post_error": "execution_error",
  "reply_error": "execution_error",
  "affiliate_error": "execution_error",
  "own_post_comment_error": "execution_error",
  "execution_failed": "execution_error",
  "timeout": "task_timeout",
  "session_expired": "session_expired"
});
const LEGACY_TASK_TYPE_MAP = Object.freeze({
  "affiliate": "affiliate_comment",
  "post_comment": "own_post_comment",
  "interaction": "reply",
  "replies": "reply",
  "friend": "auto_connect",
  "post_tasks": "post"
});
const LEGACY_TRANSPORT_TASK_TYPE = Object.freeze({
  "affiliate_comment": "affiliate",
  "own_post_comment": "post_comment"
});
const taskTypes = new Set(Object.values(TASK_TYPES));
const statuses = new Set(Object.values(TASK_STATUS));
const failureCodes = new Set(Object.values(FAILURE_CODES));
const terminalTaskStatuses = new Set(TERMINAL_TASK_STATUSES);
function normalizeTaskType(value) {
  const raw = String(value || '').trim().toLowerCase();
  return taskTypes.has(raw) ? raw : LEGACY_TASK_TYPE_MAP[raw] || null;
}
function normalizeTaskStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  return statuses.has(raw) ? raw : LEGACY_STATUS_MAP[raw] || null;
}
function normalizeFailureCode(value) {
  if (value == null || value === '') return '';
  const raw = String(value).trim().toLowerCase();
  return failureCodes.has(raw) ? raw : null;
}
function normalizeLegacyFailureCode(value) {
  const normalized = normalizeFailureCode(value);
  if (normalized !== null) return normalized;
  return LEGACY_FAILURE_CODE_MAP[String(value || '').trim().toLowerCase()] || null;
}
function isTerminalTaskStatus(value) {
  return terminalTaskStatuses.has(String(value || '').trim().toLowerCase());
}
function getTaskMetadata(value) {
  const type = normalizeTaskType(value);
  return type ? TASK_METADATA[type] : null;
}
function isFailureRetryable(taskType, status, failureCode) {
  const normalizedStatus = normalizeTaskStatus(status);
  const normalizedFailure = normalizeFailureCode(failureCode);
  const metadata = getTaskMetadata(taskType);
  if (normalizedStatus !== TASK_STATUS.FAILED || !normalizedFailure || !metadata) return false;
  return metadata.retryable_failure_codes.includes(normalizedFailure);
}
function toLegacyTransportTaskType(value) {
  const canonical = normalizeTaskType(value);
  return canonical ? LEGACY_TRANSPORT_TASK_TYPE[canonical] || canonical : null;
}

globalThis.AVJP = globalThis.AVJP || {};
globalThis.AVJP.contractData = { CONTRACT_VERSION, TASK_TYPES, TASK_STATUS, DELIVERY_STATUS, FAILURE_CODES, TASK_METADATA, TERMINAL_TASK_STATUSES, LEGACY_STATUS_MAP, LEGACY_FAILURE_CODE_MAP, LEGACY_TASK_TYPE_MAP, LEGACY_TRANSPORT_TASK_TYPE, normalizeTaskType, normalizeTaskStatus, normalizeFailureCode, normalizeLegacyFailureCode, isTerminalTaskStatus, getTaskMetadata, isFailureRetryable, toLegacyTransportTaskType };
})();
