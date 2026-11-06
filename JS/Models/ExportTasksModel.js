// The export ledger: who exported what, when, and how many rows.
//
// It holds no exported data and no files. The .xlsx is built in the browser
// and saved to the operator's own disk, exactly as it always was — storing
// the file would mean Supabase Storage, and every download from Storage is
// billed egress. So the page offers "Re-run" rather than "Download": the row
// records the parameters, and repeating the export costs the same as the
// first one did.
//
// Two requests per export (start, finish) plus one per page of rows. See
// Utils/exportChunking.js for what that costs against the monthly log
// ingestion allowance.
import { supabase } from '../Core/supabaseClient.js';

// The server's clamp, mirrored here so the page-size selector cannot offer
// more than get_export_tasks() will return. Asking for more than the clamp
// does not error -- it quietly returns fewer rows, and the next page's
// offset then steps over the difference. A test asserts this matches both
// the migration and Pagination.js's largest option.
export const EXPORT_TASKS_MAX_PAGE_SIZE = 500;

// Default rows per listing page. Nothing like the export's own page size —
// this is a table someone reads, not a payload being streamed.
export const EXPORT_TASKS_PAGE_SIZE = 50;

export const ExportTasksModel = {
  /**
   * Record that an export is starting, BEFORE any rows are fetched.
   *
   * Deliberately not written at the end. A browser that dies mid-export
   * leaves a row stuck on 'running', and that is the honest outcome: the rows
   * really did leave the database and nothing knows whether they reached a
   * disk. A ledger that only records successes is a receipt, not a record.
   *
   * @returns {Promise<{ data: string|null, error: any }>} the new task id
   */
  async start(module, filename, params = {}) {
    return supabase.rpc('start_export_task', {
      p_module: module,
      p_filename: filename,
      p_params: params,
    });
  },

  /** Settle a task. Only its own owner can, and only while it is running. */
  async finish(id, { status, rowCount = null, detail = null }) {
    return supabase.rpc('finish_export_task', {
      p_id: id,
      p_status: status,
      p_row_count: rowCount,
      p_detail: detail,
    });
  },

  // Scoped server-side: an admin gets every task, everyone else gets their
  // own. Enforced by RLS on export_tasks as well as by the function, so the
  // rule holds even if something ever reads the table directly.
  //
  // total_count rides along on every row (count(*) over ()) rather than
  // coming from a second count RPC — one repeated bigint is cheaper than an
  // extra request and its log event.
  async list({ limit = EXPORT_TASKS_PAGE_SIZE, offset = 0, module = null, from = null, to = null } = {}) {
    return supabase.rpc('get_export_tasks', {
      p_limit: Math.min(limit, EXPORT_TASKS_MAX_PAGE_SIZE),
      p_offset: offset,
      p_module: module,
      p_from: from,
      p_to: to,
    });
  },
};
