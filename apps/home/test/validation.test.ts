import { describe, expect, it } from "vitest";
import {
  authErrorMessage,
  isValidEmail,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePassword,
} from "../src/auth/validation.ts";

describe("validation de la connexion et de l'inscription", () => {
  it("accepte une adresse bien formée et refuse les formes douteuses", () => {
    expect(isValidEmail(" prenom@exemple.org ")).toBe(true);
    expect(isValidEmail("prenom@exemple")).toBe(false);
    expect(validateEmail("")).toBe("Indiquez votre adresse e-mail.");
    expect(validateEmail("x@y.z")).toMatch(/semble incorrecte/);
  });

  it("exige un nom d'au moins deux caractères", () => {
    expect(validateName("  ")).toBe("Indiquez votre nom.");
    expect(validateName("A")).toMatch(/au moins 2/);
    expect(validateName("Al")).toBeUndefined();
  });

  it("exige 10 caractères à l'inscription mais seulement un mot de passe à la connexion", () => {
    expect(validateNewPassword("court")).toMatch(/actuel : 5/);
    expect(validateNewPassword("0123456789")).toBeUndefined();
    expect(validatePassword("")).toBe("Indiquez votre mot de passe.");
    expect(validatePassword("x")).toBeUndefined();
  });

  it("ne révèle pas si l'adresse existe en cas d'échec de connexion", () => {
    const a = authErrorMessage("INVALID_EMAIL", "?");
    const b = authErrorMessage("INVALID_PASSWORD", "?");
    expect(a).toBe(b);
    expect(authErrorMessage("CODE_INCONNU", "Repli")).toBe("Repli");
    expect(authErrorMessage(null, "Repli")).toBe("Repli");
  });
});
