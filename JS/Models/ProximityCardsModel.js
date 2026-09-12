// Proximity card inventory: issue, revoke, renew, delete, and the raw list
// used by both the Proximity Cards page and the Employee modal's card picker.
import { supabase } from '../Core/supabaseClient.js';
import { createModel } from './BaseModel.js';
import { sanitizeSearchTerm } from '../Utils/search.js';

const base = createModel('proximity_cards');

export const ProximityCardsModel = {
  ...base,

  async listAll() {
    return supabase.from('proximity_cards').select('id, proximity_code, is_active');
  },

  // Proximity Cards grid — paginated + searched server-side against
  // proximity_card_directory (card + assignee name/code in one row), the
  // same fix as EmployeesModel#listDirectoryPage and for the same reason:
  // 700+ cards fetched in full on every load was the slow part, not the
  // rendering.
  async listDirectoryPage({ page = 1, pageSize = 20, search = '', status = 'all' } = {}) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let query = supabase.from('proximity_card_directory').select('*', { count: 'exact' });
    if (status !== 'all') query = query.eq('is_active', status === 'active');
    const term = sanitizeSearchTerm(search);
    if (term) {
      query = query.or(`proximity_code.ilike.%${term}%,employee_name.ilike.%${term}%,employee_code.ilike.%${term}%`);
    }
    return query.order('issued_at', { ascending: false }).range(from, to);
  },

  // Card picker for the Employee modal — reads the small "nobody's linked
  // to this yet" pool instead of pulling all cards + all employees to
  // compute it client-side. When editing, the employee's own current card
  // (already assigned, so it won't be in that pool) is unioned in.
  async listAvailable(currentCardId) {
    const { data, error } = await supabase
      .from('unassigned_active_proximity_cards')
      .select('id, proximity_code')
      .order('proximity_code');
    if (error) return { data, error };
    if (currentCardId && !(data || []).some((c) => c.id === currentCardId)) {
      const { data: current } = await supabase
        .from('proximity_cards')
        .select('id, proximity_code')
        .eq('id', currentCardId)
        .maybeSingle();
      if (current) return { data: [current, ...data], error: null };
    }
    return { data, error: null };
  },

  async issue(proximity_code, createdBy) {
    return supabase.from('proximity_cards').insert({ proximity_code, created_by: createdBy });
  },

  async issueAndReturnId(proximity_code, createdBy) {
    return supabase.from('proximity_cards').insert({ proximity_code, created_by: createdBy }).select('id').single();
  },

  // Bulk issue for CSV import — one round trip per chunk instead of one
  // per row. Returns the inserted rows (id + code) so the caller can map
  // each new card back to the file row that requested it.
  async issueMany(codes, createdBy) {
    return supabase
      .from('proximity_cards')
      .insert(codes.map((proximity_code) => ({ proximity_code, created_by: createdBy })))
      .select('id, proximity_code');
  },

  // Revoking now goes through the RPC so the reason can cascade into the
  // linked employee's remarks in the same atomic call — see
  // revoke_proximity_card() in Supabase/README.md.
  async revoke(id, reason) {
    return supabase.rpc('revoke_proximity_card', { p_card_id: id, p_reason: reason || null });
  },

  async renew(id) {
    return supabase.from('proximity_cards')
      .update({ is_active: true, revoked_at: null, revoke_reason: null, issued_at: new Date().toISOString() })
      .eq('id', id);
  },

  async remove(id) {
    return supabase.from('proximity_cards').delete().eq('id', id);
  },

  async removeMany(ids) {
    return supabase.from('proximity_cards').delete().in('id', ids);
  },

  // Pre-existing server-side RPC (admin-only, enforced inside the function)
  // that deletes every unassigned card in one atomic statement — used
  // instead of fetching ids client-side and filtering, which is both
  // slower and racier at scale.
  async deleteAllUnassigned() {
    return supabase.rpc('delete_unassigned_proximity_cards');
  },
};
