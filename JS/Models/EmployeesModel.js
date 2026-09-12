// All employee-related reads/writes: the directory view (for the grid),
// the underlying `employees` table (for create/update/delete + scan logs),
// and the lookups the Employee modal needs to offer available cards.
import { supabase } from '../Core/supabaseClient.js';
import { createModel } from './BaseModel.js';

const base = createModel('employees');

export const EmployeesModel = {
  ...base,

  // Employee Manager grid — denormalized view with card + scan totals.
  async listDirectory() {
    return supabase.from('employee_directory').select('*').order('full_name');
  },

  // employee_id -> proximity_card_id lookups (used to filter out cards
  // that are already assigned to someone else).
  async listCardLinks() {
    return supabase.from('employees').select('proximity_card_id');
  },

  // Used by the Proximity Cards page to show who a card belongs to.
  async listForCardAssignment() {
    return supabase.from('employees').select('id, full_name, employee_code, proximity_card_id');
  },

  async createEmployee(payload) {
    return supabase.from('employees').insert(payload);
  },

  // Bulk insert used by CSV import — one round-trip per chunk instead of
  // one per row. Returns the same {data,error} shape as a single insert;
  // on error the caller falls back to inserting that chunk row-by-row to
  // find out exactly which row failed.
  async createMany(payloads) {
    return supabase.from('employees').insert(payloads).select('id');
  },

  async updateEmployee(id, payload) {
    return supabase.from('employees').update(payload).eq('id', id);
  },

  async deleteEmployee(id) {
    return supabase.from('employees').delete().eq('id', id);
  },

  async deleteMany(ids) {
    return supabase.from('employees').delete().in('id', ids);
  },

  // "Delete all" used to collect every employee id and call deleteMany()
  // with all of them in one .in(...) — fine for a handful of rows, but
  // with hundreds+ the resulting URL (PostgREST filters are query params,
  // even for DELETE) blew past the API gateway's URL length limit and
  // came back as a flat 400 Bad Request with no useful message. A filter
  // that's true for every row sidesteps building that list entirely — one
  // request, any table size, same admin-only RLS.
  async deleteAll() {
    return supabase.from('employees').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  },

  async getScanLogs(employeeId) {
    return supabase.from('employees').select('full_name, scan_logs').eq('id', employeeId).single();
  },

  async getRemarks(employeeId) {
    return supabase.from('employees').select('full_name, remarks_log').eq('id', employeeId).single();
  },

  // Appends via the add_employee_remark() RPC (not a plain update) so two
  // people adding a remark to the same employee at once can't clobber each
  // other's entry — same reasoning as the scan_logs append trigger.
  async addRemark(employeeId, remark) {
    return supabase.rpc('add_employee_remark', { p_employee_id: employeeId, p_remark: remark });
  },

  // Toggles a single remark's resolved flag (also via RPC, same
  // concurrent-safe reasoning as addRemark).
  async resolveRemark(employeeId, remarkId, resolved) {
    return supabase.rpc('resolve_employee_remark', { p_employee_id: employeeId, p_remark_id: remarkId, p_resolved: resolved });
  },
};
