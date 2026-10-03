ALTER TABLE public.employees
  DROP CONSTRAINT employees_status_check,
  ADD CONSTRAINT employees_status_check
    CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'suspended'::text, 'resigned'::text]));

DROP FUNCTION public.revoke_proximity_card(uuid, text);

CREATE FUNCTION public.revoke_proximity_card(
  p_card_id uuid,
  p_employee_status text,
  p_additional_remarks text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code text;
  v_is_active boolean;
  v_employee_id uuid;
  v_previous_status text;
  v_additional_remarks text := nullif(btrim(coalesce(p_additional_remarks, '')), '');
  v_entry jsonb;
BEGIN
  IF NOT (public.is_admin_or_manager() AND public.can_view_employee_manager()) THEN
    RAISE EXCEPTION 'not permitted to revoke proximity cards';
  END IF;

  IF p_employee_status IS NOT NULL
     AND p_employee_status NOT IN ('active', 'inactive', 'suspended', 'resigned') THEN
    RAISE EXCEPTION 'invalid employee status';
  END IF;

  SELECT c.proximity_code, c.is_active
    INTO v_code, v_is_active
    FROM public.proximity_cards AS c
    WHERE c.id = p_card_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proximity card not found';
  END IF;

  IF NOT v_is_active THEN
    RAISE EXCEPTION 'Proximity card is already revoked';
  END IF;

  SELECT e.id, e.status
    INTO v_employee_id, v_previous_status
    FROM public.employees AS e
    WHERE e.proximity_card_id = p_card_id
    FOR UPDATE;

  IF FOUND AND p_employee_status IS NULL THEN
    RAISE EXCEPTION 'employee status is required for an assigned card';
  END IF;

  IF NOT FOUND AND p_employee_status IS NOT NULL THEN
    RAISE EXCEPTION 'employee status must be null for an unassigned card';
  END IF;

  UPDATE public.proximity_cards
    SET is_active = false,
        revoked_at = now(),
        revoke_reason = v_additional_remarks
    WHERE id = p_card_id;

  IF v_employee_id IS NOT NULL THEN
    v_entry := jsonb_build_object(
      'id', gen_random_uuid(),
      'remark', 'Proximity card revoked. Employee status set to ' || initcap(p_employee_status) || '.' ||
        CASE
          WHEN v_additional_remarks IS NOT NULL
          THEN ' Additional remarks: ' || v_additional_remarks
          ELSE ''
        END,
      'created_by', (SELECT p.full_name FROM public.profiles AS p WHERE p.id = auth.uid()),
      'created_by_id', auth.uid(),
      'created_at', now(),
      'resolved', false
    );

    UPDATE public.employees AS e
      SET status = p_employee_status,
          updated_by = auth.uid(),
          remarks_log = coalesce(e.remarks_log, '[]'::jsonb) || jsonb_build_array(v_entry)
      WHERE e.id = v_employee_id;
  END IF;

  PERFORM public.log_audit_event(
    'card_revoked',
    'proximity_card',
    p_card_id::text,
    jsonb_build_object(
      'proximity_code', v_code,
      'employee_id', v_employee_id,
      'previous_employee_status', v_previous_status,
      'employee_status', p_employee_status,
      'additional_remarks', v_additional_remarks
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'employee_id', v_employee_id,
    'employee_status', p_employee_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.revoke_proximity_card(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_proximity_card(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_proximity_card(uuid, text, text) TO service_role;