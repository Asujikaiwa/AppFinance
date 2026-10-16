-- ============================================================================
-- Seed default chart of accounts when a workspace is created.
-- Mirrors `packages/tax-core/src/categories.ts` DEFAULT_CATEGORIES.
-- ============================================================================

create or replace function public.seed_default_categories(ws_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.categories (workspace_id, code, name_th, name_en, direction, deductible, vat_applicable, default_wht_rate, is_system) values
    (ws_id, '4100', 'รายได้จากการขายสินค้า', 'Sales revenue', 'income', false, true, null, true),
    (ws_id, '4200', 'รายได้ค่าบริการ', 'Service revenue', 'income', false, true, null, true),
    (ws_id, '4900', 'รายได้อื่นๆ', 'Other income', 'income', false, false, null, true),
    (ws_id, '5100-01', 'ค่าน้ำมันรถ', 'Fuel', 'expense', true, true, null, true),
    (ws_id, '5100-02', 'ค่าเดินทาง', 'Travel', 'expense', true, false, null, true),
    (ws_id, '5200', 'ค่าเช่า', 'Rent', 'expense', true, false, 0.0500, true),
    (ws_id, '5300', 'ค่าสาธารณูปโภค', 'Utilities', 'expense', true, true, null, true),
    (ws_id, '5400', 'ค่าโทรศัพท์/อินเทอร์เน็ต', 'Telecom/Internet', 'expense', true, true, null, true),
    (ws_id, '5500', 'ค่าโฆษณาและประชาสัมพันธ์', 'Advertising', 'expense', true, true, 0.0200, true),
    (ws_id, '5600', 'ค่าบริการวิชาชีพ', 'Professional fees', 'expense', true, true, 0.0300, true),
    (ws_id, '5700', 'ค่าซอฟต์แวร์/SaaS', 'Software/SaaS', 'expense', true, true, null, true),
    (ws_id, '5800', 'ค่าอาหารและรับรอง', 'Meals & entertainment', 'expense', true, false, null, true),
    (ws_id, '5900', 'ค่าวัสดุสำนักงาน', 'Office supplies', 'expense', true, true, null, true),
    (ws_id, '6100', 'เงินเดือนพนักงาน', 'Salary', 'expense', true, false, null, true),
    (ws_id, '6200', 'ค่าขนส่ง', 'Transport/Logistics', 'expense', true, true, 0.0100, true),
    (ws_id, '9999', 'รายจ่ายต้องห้าม', 'Non-deductible expense', 'expense', false, false, null, true);
end;
$$;

-- Auto-seed on workspace creation
create or replace function public.workspace_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_default_categories(new.id);
  return new;
end;
$$;

create trigger workspaces_after_insert
  after insert on public.workspaces
  for each row execute function public.workspace_after_insert();
