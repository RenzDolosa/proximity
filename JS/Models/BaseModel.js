// Generic table wrapper so every Model shares the same list/get/create/
// update/remove shape instead of hand-rolling `.from(table)` calls
// everywhere. Table-specific models (see EmployeesModel.js etc.) wrap this
// and add whatever custom queries that table actually needs.
import { supabase } from '../Core/supabaseClient.js';

export function createModel(table) {
  return {
    table,

    async list({ select = '*', orderBy, ascending = true } = {}) {
      let query = supabase.from(table).select(select);
      if (orderBy) query = query.order(orderBy, { ascending });
      return query;
    },

    async get(id, select = '*') {
      return supabase.from(table).select(select).eq('id', id).single();
    },

    async create(payload) {
      return supabase.from(table).insert(payload).select().single();
    },

    async update(id, payload) {
      return supabase.from(table).update(payload).eq('id', id);
    },

    async remove(id) {
      return supabase.from(table).delete().eq('id', id);
    },
  };
}
