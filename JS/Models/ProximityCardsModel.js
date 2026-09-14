// Proximity card inventory: issue, revoke, renew, delete, and the raw list
// used by both the Proximity Cards page and the Employee modal's card picker.
import { supabase } from '../Core/supabaseClient.js';
import { createModel } from './BaseModel.js';
import { fetchAllRows } from '../Utils/fetchAllRows.js';

const base = createModel('proximity_cards');

export const ProximityCardsModel = {
  ...base,

  // Pages through past Supabase's default 1000-row-per-request cap — see
  // Utils/fetchAllRows.js. Backs the Employee modal's card-search combobox
  // and (via listForTable) the Proximity Cards page; both need the true
  // full set, not a truncated one, since a card sitting past row 1000
  // needs to be just as findable/manageable as any other.
  async listAll() {
    return fetchAllRows((from, to) =>
      supabase.from('proximity_cards').select('id, proximity_code, is_active').range(from, to)
    );
  },

  async listForTable() {
    return fetchAllRows((from, to) =>
      supabase
        .from('proximity_cards')
        .select('id, proximity_code, is_active, issued_at, revoked_at')
        .order('issued_at', { ascending: false })
        .range(from, to)
    );
  },

  async issue(proximity_code, createdBy) {
    return supabase.from('proximity_cards').insert({ proximity_code, created_by: createdBy });
  },

  async issueAndReturnId(proximity_code, createdBy) {
    return supabase.from('proximity_cards').insert({ proximity_code, created_by: createdBy }).select('id').single();
  },

  // Bulk insert used by CSV import — see EmployeesModel.createMany for why.
  async issueMany(rows) {
    return supabase.from('proximity_cards').insert(rows).select('id, proximity_code');
  },

  async revoke(id) {
    return supabase.from('proximity_cards').update({ is_active: false, revoked_at: new Date().toISOString() }).eq('id', id);
  },

  async renew(id) {
    return supabase.from('proximity_cards').update({ is_active: true, revoked_at: null, issued_at: new Date().toISOString() }).eq('id', id);
  },

  async remove(id) {
    return supabase.from('proximity_cards').delete().eq('id', id);
  },

  async removeMany(ids) {
    return supabase.from('proximity_cards').delete().in('id', ids);
  },

  // Single server-side statement instead of fetching every unassigned id
  // and deleting in client-side chunks — see the delete_unassigned_proximity_cards
  // migration for why. Returns the number of cards actually deleted.
  async deleteAllUnassigned() {
    return supabase.rpc('delete_unassigned_proximity_cards');
  },
};
