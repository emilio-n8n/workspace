import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  browserTimeZone,
  listTimeZoneOptions,
  parseStoredTimeZone,
  type TimeZoneOption,
} from "./timezone.ts";

/** Clé de la préférence de fuseau dans le stockage local du navigateur. */
export const TIME_ZONE_STORAGE_KEY = "workspace.calendar.timeZone";

export type DisplayTimeZone = {
  /** Fuseau d'affichage courant (le stockage reste en UTC). */
  zone: string;
  /** Fuseau de l'appareil, pour l'indicateur de décalage. */
  browserZone: string;
  /** Liste restreinte des fuseaux proposés, avec décalages. */
  options: TimeZoneOption[];
  changeZone: (zone: string) => void;
};

/** Valeur de repli hors provider : le fuseau de l'appareil, sans mémorisation. */
function fallbackValue(): DisplayTimeZone {
  return {
    zone: browserTimeZone(),
    browserZone: browserTimeZone(),
    options: listTimeZoneOptions(),
    changeZone: () => undefined,
  };
}

const DisplayTimeZoneContext = createContext<DisplayTimeZone | null>(null);

/**
 * Fuseau d'affichage du calendrier, persisté localement. Le stockage des
 * événements reste en UTC : le fuseau ne sert qu'à présenter les instants
 * (heures, jours, libellés) et à interpréter la création rapide.
 *
 * La lecture du stockage a lieu après le montage : le rendu serveur et la
 * première peinture côté client partagent la même valeur, sans décalage
 * d'hydratation.
 */
export function CalendarTimeZoneProvider({ children }: { children: ReactNode }) {
  const browserZone = useMemo(() => browserTimeZone(), []);
  const [zone, setZone] = useState(browserZone);
  const options = useMemo(() => listTimeZoneOptions(), []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TIME_ZONE_STORAGE_KEY);
      setZone(parseStoredTimeZone(stored));
    } catch {
      // Stockage indisponible : le fuseau de l'appareil reste utilisé.
    }
  }, []);

  const changeZone = useCallback((next: string) => {
    setZone(next);
    try {
      window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, next);
    } catch {
      // Préférence non mémorisée : elle ne vaudra que pour cette session.
    }
  }, []);

  const value = useMemo<DisplayTimeZone>(
    () => ({ zone, browserZone, options, changeZone }),
    [zone, browserZone, options, changeZone],
  );

  return (
    <DisplayTimeZoneContext.Provider value={value}>{children}</DisplayTimeZoneContext.Provider>
  );
}

/** Fuseau d'affichage courant (repli : fuseau de l'appareil). */
export function useDisplayTimeZone(): DisplayTimeZone {
  return useContext(DisplayTimeZoneContext) ?? fallbackValue();
}
