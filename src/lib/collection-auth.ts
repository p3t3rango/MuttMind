import { getSupabaseAdmin } from './supabase';

/**
 * Authorizes the user as an editor of the Collection (owner counts as editor).
 * Throws on failure:
 *   - 'Collection not found' if no such Collection
 *   - 'Not an editor of this Collection' if the user is neither owner nor in collection_members
 * Returns `{ isOwner: boolean }` on success so callers can branch on owner-only actions.
 */
export async function assertCollectionEditor(
  collectionId: string,
  userId: string,
): Promise<{ isOwner: boolean }> {
  const admin = getSupabaseAdmin();
  const { data: collection } = await admin
    .from('collections')
    .select('owner_user_id')
    .eq('id', collectionId)
    .maybeSingle();
  if (!collection) throw new Error('Collection not found');
  if (collection.owner_user_id === userId) return { isOwner: true };

  const { data: member } = await admin
    .from('collection_members')
    .select('user_id')
    .eq('collection_id', collectionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!member) throw new Error('Not an editor of this Collection');
  return { isOwner: false };
}

/**
 * Authorizes the user as the OWNER of the Collection.
 * Throws on failure (same messages as assertCollectionEditor, plus 'Owner-only action' for non-owner editors).
 */
export async function assertCollectionOwner(
  collectionId: string,
  userId: string,
): Promise<void> {
  const result = await assertCollectionEditor(collectionId, userId);
  if (!result.isOwner) throw new Error('Owner-only action');
}
