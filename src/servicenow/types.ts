export interface ServiceNowRecord {
  sys_id: string;
  sys_created_on?: string;
  sys_updated_on?: string;
  sys_created_by?: string;
  sys_updated_by?: string;
  [key: string]: unknown;
}

export interface Incident extends ServiceNowRecord {
  number: string;
  short_description: string;
  description?: string;
  state: string;
  impact: string;
  urgency: string;
  priority: string;
  category?: string;
  subcategory?: string;
  assigned_to: string;
  assignment_group: string;
  caller_id: string;
  cmdb_ci?: string;
  opened_at: string;
  opened_by: string;
  resolved_at?: string;
  resolved_by?: string;
  closed_at?: string;
  close_code?: string;
  close_notes?: string;
  work_notes?: string;
  comments?: string;
}

export interface User extends ServiceNowRecord {
  user_name: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  department?: string;
  title?: string;
  manager?: string;
  active: string;
  employee_number?: string;
  location?: string;
}

export interface Group extends ServiceNowRecord {
  name: string;
  description?: string;
  manager?: string;
  email?: string;
  active: string;
  type?: string;
}

export interface Task extends ServiceNowRecord {
  number: string;
  short_description: string;
  state: string;
  priority: string;
  assigned_to: string;
  assignment_group: string;
  sys_class_name: string;
  opened_at: string;
  due_date?: string;
}

export interface Approval extends ServiceNowRecord {
  state: string;
  approver: string;
  sysapproval: string;
  source_table: string;
  comments?: string;
  due_date?: string;
  sys_created_on: string;
}

export interface CatalogItem extends ServiceNowRecord {
  name: string;
  short_description: string;
  description?: string;
  category: string;
  price?: string;
  picture?: string;
  active: string;
}

export interface ChangeRequest extends ServiceNowRecord {
  number: string;
  short_description: string;
  description?: string;
  state: string;
  type: string;
  category?: string;
  priority: string;
  impact: string;
  urgency: string;
  risk: string;
  assigned_to: string;
  assignment_group: string;
  requested_by: string;
  opened_by: string;
  start_date?: string;
  end_date?: string;
  close_code?: string;
  close_notes?: string;
  cmdb_ci?: string;
  business_service?: string;
  work_notes?: string;
  comments?: string;
}

export interface KnowledgeArticle extends ServiceNowRecord {
  number: string;
  short_description: string;
  text?: string;
  kb_knowledge_base: string;
  kb_category?: string;
  author?: string;
  published?: string;
  workflow_state: string;
}

export interface CatalogVariable extends ServiceNowRecord {
  name: string;
  question_text: string;
  type: string;
  cat_item: string;
  mandatory?: string;
  order?: string;
  default_value?: string;
  reference?: string;
  reference_qual?: string;
  help_text?: string;
  hidden?: string;
  read_only?: string;
  variable_set?: string;
}

export interface VariableChoice extends ServiceNowRecord {
  question: string;
  text: string;
  value: string;
  order?: string;
}

export interface VariableSet extends ServiceNowRecord {
  title: string;
  internal_name: string;
  type?: string;
  description?: string;
  order?: string;
}

export interface VariableSetItem extends ServiceNowRecord {
  sc_cat_item: string;
  variable_set: string;
  order?: string;
}

export interface CatalogClientScript extends ServiceNowRecord {
  name: string;
  cat_item?: string;
  type: string;
  script: string;
  cat_variable?: string;
  applies_to?: string;
  variable_set?: string;
  ui_type?: string;
  active?: string;
  applies_catalog?: string;
  applies_req_item?: string;
}

export interface CatalogUIPolicy extends ServiceNowRecord {
  short_description: string;
  catalog_item?: string;
  catalog_conditions: string;
  on_load?: string;
  reverse_if_false?: string;
  order?: string;
  applies_to?: string;
  variable_set?: string;
  ui_type?: string;
  run_scripts?: string;
  script_true?: string;
  script_false?: string;
  active?: string;
}

export interface CatalogUIPolicyAction extends ServiceNowRecord {
  ui_policy: string;
  catalog_variable: string;
  visible?: string;
  mandatory?: string;
  disabled?: string;
  cleared?: string;
}

export interface ServiceNowListResponse<T = ServiceNowRecord> {
  result: T[];
}

export interface ServiceNowSingleResponse<T = ServiceNowRecord> {
  result: T;
}
