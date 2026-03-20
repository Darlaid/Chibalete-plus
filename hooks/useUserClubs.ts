import { useMemo } from 'react';
import type { User } from '../types';
import { dataService } from '../services/dataService';
import type { Group, Content } from '../types';

export interface ClubWithContent {
  club: Group;
  content: Content[];
}

/**
 * useUserClubs
 *
 * Dado un usuario autenticado, devuelve:
 *  - clubs: grupos de tipo 'club' donde el usuario es miembro o mediador
 *  - clubsWithContent: cada club junto con sus libros disponibles
 *
 * No hace fetch: usa la caché de dataService ya cargada en inicialización.
 * Si el usuario no tiene clubs (o no hay contenido asignado), devuelve arrays vacíos.
 */
export function useUserClubs(user: User | null): {
  clubs: Group[];
  clubsWithContent: ClubWithContent[];
} {
  return useMemo(() => {
    if (!user) return { clubs: [], clubsWithContent: [] };

    const allGroups = dataService.getAllGroups();

    // Un usuario pertenece a un club si está en memberIds O mediatorIds
    const clubs = allGroups.filter(
      (g) =>
        g.type === 'club' &&
        (
          (Array.isArray(g.memberIds) && g.memberIds.includes(user.id)) ||
          (Array.isArray(g.mediatorIds) && g.mediatorIds.includes(user.id))
        )
    );

    const clubsWithContent: ClubWithContent[] = clubs
      .map((club) => ({
        club,
        content: dataService.getClubContent(club),
      }))
      .filter((cc) => cc.content.length > 0); // Solo mostrar clubs con contenido real

    return { clubs, clubsWithContent };
  }, [user]);
}
