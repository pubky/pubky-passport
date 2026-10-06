export interface PassportDiagnostic {
  code:
    | "no_user_activation"
    | "window_closed_before_handshake"
    | "opener_severed_suspected"
    | "cross_origin_isolated"
    | "handshake_missing"
    | "request_lost"
    | "passport_protocol_v1"
    | "message_ignored"
    | "qr_too_large"
    | "instance_choice_ignored"
    | "redirect_unavailable"
    | "redirect_state_discarded"
    | "capability_mismatch"
    | "late_session_revoked"
    | "duplicate_session_revoked"
    | "revoke_failed"
    | "profile_check_failed"
    | "sdk_duplicate_suspected"
    | "config_invalid";
  attemptId?: string;
  reason?: string;
}
