/** Erreurs d'autorisation, typées et sans fuite d'information. */

export type PolicyErrorCode = "forbidden" | "invalid_action" | "invalid_resource" | "not_found";

export class PolicyError extends Error {
  readonly code: PolicyErrorCode;

  constructor(code: PolicyErrorCode, message: string) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
  }

  static forbidden(message = "Accès refusé : permission insuffisante."): PolicyError {
    return new PolicyError("forbidden", message);
  }

  static invalidAction(action: string): PolicyError {
    return new PolicyError("invalid_action", `Action inconnue : ${String(action)}`);
  }

  static invalidResource(message: string): PolicyError {
    return new PolicyError("invalid_resource", message);
  }

  static notFound(message = "Ressource introuvable."): PolicyError {
    return new PolicyError("not_found", message);
  }
}
