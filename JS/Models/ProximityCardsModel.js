// Proximity card inventory: issue, revoke, renew, delete, and the raw list
// used by both the Proximity Cards page and the Employee modal's card picker.
import { supabase } from '../Core/supabaseClient.js';
import { createModel } from './BaseModel.js';

const base = createModel('proximity_cards');

export const ProximityCardsModel = {
  ...base,

  async listAll() {
    return supabase.from('proximity_cards').select('id, proximity_code, is_active');
  },

  async listForTable() {
    return supabase
      .from('proximity_cards')
      .select('id, proximity_code, is_active, issued_at, revoked_at')
      .order('issued_at', { ascending: false });
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
};
