export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      employees: {
        Row: {
          address: string | null
          address_detail: string | null
          code: string
          created_at: string
          created_by: string | null
          department: string | null
          driver_operation_type:
            | Database["public"]["Enums"]["driver_operation_type"]
            | null
          email: string | null
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          hire_date: string
          id: string
          is_active: boolean
          is_delivery_driver: boolean
          is_salary_paid: boolean
          is_sales_rep: boolean
          job_title: string | null
          mobile: string | null
          mobile2: string | null
          name: string
          note: string | null
          phone: string | null
          postal_code: string | null
          resignation_date: string | null
          updated_at: string
          updated_by: string | null
          vehicle_number: string | null
          vehicle_type: Database["public"]["Enums"]["vehicle_type"] | null
        }
        Insert: {
          address?: string | null
          address_detail?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          department?: string | null
          driver_operation_type?:
            | Database["public"]["Enums"]["driver_operation_type"]
            | null
          email?: string | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          hire_date: string
          id?: string
          is_active?: boolean
          is_delivery_driver?: boolean
          is_salary_paid?: boolean
          is_sales_rep?: boolean
          job_title?: string | null
          mobile?: string | null
          mobile2?: string | null
          name: string
          note?: string | null
          phone?: string | null
          postal_code?: string | null
          resignation_date?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_number?: string | null
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"] | null
        }
        Update: {
          address?: string | null
          address_detail?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          department?: string | null
          driver_operation_type?:
            | Database["public"]["Enums"]["driver_operation_type"]
            | null
          email?: string | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          hire_date?: string
          id?: string
          is_active?: boolean
          is_delivery_driver?: boolean
          is_salary_paid?: boolean
          is_sales_rep?: boolean
          job_title?: string | null
          mobile?: string | null
          mobile2?: string | null
          name?: string
          note?: string | null
          phone?: string | null
          postal_code?: string | null
          resignation_date?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_number?: string | null
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"] | null
        }
        Relationships: []
      }
      partner_addresses: {
        Row: {
          address: string
          address_detail: string | null
          created_at: string
          id: string
          is_default: boolean
          label: string
          memo: string | null
          partner_id: string
          phone: string | null
          postal_code: string | null
          recipient: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          address: string
          address_detail?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          label: string
          memo?: string | null
          partner_id: string
          phone?: string | null
          postal_code?: string | null
          recipient?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          address?: string
          address_detail?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          memo?: string | null
          partner_id?: string
          phone?: string | null
          postal_code?: string | null
          recipient?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_addresses_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partner_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_addresses_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "partner_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_contacts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_primary: boolean
          job_title: string | null
          memo: string | null
          mobile: string | null
          name: string
          partner_id: string
          phone: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          job_title?: string | null
          memo?: string | null
          mobile?: string | null
          name: string
          partner_id: string
          phone?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          job_title?: string | null
          memo?: string | null
          mobile?: string | null
          name?: string
          partner_id?: string
          phone?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_contacts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partner_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_contacts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          address: string | null
          address_detail: string | null
          business_category: string | null
          business_item: string | null
          business_number: string | null
          category_id: string | null
          code: string
          company_name: string | null
          created_at: string
          created_by: string | null
          credit_limit: number | null
          credit_limit_type: Database["public"]["Enums"]["credit_limit_type"]
          delivery_rep_id: string | null
          id: string
          industry: Database["public"]["Enums"]["partner_industry"] | null
          invoice_type: Database["public"]["Enums"]["invoice_type"]
          is_active: boolean
          name: string
          note: string | null
          partner_type: Database["public"]["Enums"]["partner_type"]
          payment_day: number | null
          payment_term: Database["public"]["Enums"]["payment_term"]
          phone: string | null
          postal_code: string | null
          representative: string | null
          sales_rep_id: string | null
          slip_print: Database["public"]["Enums"]["slip_print_type"]
          tax_email: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          address_detail?: string | null
          business_category?: string | null
          business_item?: string | null
          business_number?: string | null
          category_id?: string | null
          code: string
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          credit_limit_type?: Database["public"]["Enums"]["credit_limit_type"]
          delivery_rep_id?: string | null
          id?: string
          industry?: Database["public"]["Enums"]["partner_industry"] | null
          invoice_type?: Database["public"]["Enums"]["invoice_type"]
          is_active?: boolean
          name: string
          note?: string | null
          partner_type: Database["public"]["Enums"]["partner_type"]
          payment_day?: number | null
          payment_term?: Database["public"]["Enums"]["payment_term"]
          phone?: string | null
          postal_code?: string | null
          representative?: string | null
          sales_rep_id?: string | null
          slip_print?: Database["public"]["Enums"]["slip_print_type"]
          tax_email?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          address_detail?: string | null
          business_category?: string | null
          business_item?: string | null
          business_number?: string | null
          category_id?: string | null
          code?: string
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          credit_limit_type?: Database["public"]["Enums"]["credit_limit_type"]
          delivery_rep_id?: string | null
          id?: string
          industry?: Database["public"]["Enums"]["partner_industry"] | null
          invoice_type?: Database["public"]["Enums"]["invoice_type"]
          is_active?: boolean
          name?: string
          note?: string | null
          partner_type?: Database["public"]["Enums"]["partner_type"]
          payment_day?: number | null
          payment_term?: Database["public"]["Enums"]["payment_term"]
          phone?: string | null
          postal_code?: string | null
          representative?: string | null
          sales_rep_id?: string | null
          slip_print?: Database["public"]["Enums"]["slip_print_type"]
          tax_email?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partners_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "partner_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partners_delivery_rep_id_fkey"
            columns: ["delivery_rep_id"]
            isOneToOne: false
            referencedRelation: "employee_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partners_delivery_rep_id_fkey"
            columns: ["delivery_rep_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partners_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "employee_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partners_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      product_bundle_items: {
        Row: {
          bundle_id: string
          component_id: string
          created_at: string
          quantity: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          bundle_id: string
          component_id: string
          created_at?: string
          quantity: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          bundle_id?: string
          component_id?: string
          created_at?: string
          quantity?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_bundle_items_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "product_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_bundle_items_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_bundle_items_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "product_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_bundle_items_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          allergens: string[]
          barcode: string | null
          category_id: string | null
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          manufacturer: string | null
          name: string
          note: string | null
          origin: string | null
          product_type: Database["public"]["Enums"]["product_type"]
          purchase_price_incl_vat: number | null
          sale_price_incl_vat: number | null
          shelf_life_days: number | null
          spec: string | null
          storage_type: Database["public"]["Enums"]["storage_type"] | null
          tax_type: Database["public"]["Enums"]["tax_type"] | null
          unit: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allergens?: string[]
          barcode?: string | null
          category_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          manufacturer?: string | null
          name: string
          note?: string | null
          origin?: string | null
          product_type?: Database["public"]["Enums"]["product_type"]
          purchase_price_incl_vat?: number | null
          sale_price_incl_vat?: number | null
          shelf_life_days?: number | null
          spec?: string | null
          storage_type?: Database["public"]["Enums"]["storage_type"] | null
          tax_type?: Database["public"]["Enums"]["tax_type"] | null
          unit: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allergens?: string[]
          barcode?: string | null
          category_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          manufacturer?: string | null
          name?: string
          note?: string | null
          origin?: string | null
          product_type?: Database["public"]["Enums"]["product_type"]
          purchase_price_incl_vat?: number | null
          sale_price_incl_vat?: number | null
          shelf_life_days?: number | null
          spec?: string | null
          storage_type?: Database["public"]["Enums"]["storage_type"] | null
          tax_type?: Database["public"]["Enums"]["tax_type"] | null
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      employee_list_items: {
        Row: {
          address: string | null
          address_detail: string | null
          address_text: string | null
          code: string | null
          created_at: string | null
          created_by: string | null
          delivery_partner_count: number | null
          department: string | null
          driver_operation_type:
            | Database["public"]["Enums"]["driver_operation_type"]
            | null
          email: string | null
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          hire_date: string | null
          id: string | null
          is_active: boolean | null
          is_delivery_driver: boolean | null
          is_salary_paid: boolean | null
          is_sales_rep: boolean | null
          job_title: string | null
          mobile: string | null
          mobile2: string | null
          name: string | null
          note: string | null
          partner_count: number | null
          phone: string | null
          postal_code: string | null
          resignation_date: string | null
          sales_partner_count: number | null
          updated_at: string | null
          updated_by: string | null
          vehicle_number: string | null
          vehicle_type: Database["public"]["Enums"]["vehicle_type"] | null
        }
        Insert: {
          address?: string | null
          address_detail?: string | null
          address_text?: never
          code?: string | null
          created_at?: string | null
          created_by?: string | null
          delivery_partner_count?: never
          department?: string | null
          driver_operation_type?:
            | Database["public"]["Enums"]["driver_operation_type"]
            | null
          email?: string | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          hire_date?: string | null
          id?: string | null
          is_active?: boolean | null
          is_delivery_driver?: boolean | null
          is_salary_paid?: boolean | null
          is_sales_rep?: boolean | null
          job_title?: string | null
          mobile?: string | null
          mobile2?: string | null
          name?: string | null
          note?: string | null
          partner_count?: never
          phone?: string | null
          postal_code?: string | null
          resignation_date?: string | null
          sales_partner_count?: never
          updated_at?: string | null
          updated_by?: string | null
          vehicle_number?: string | null
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"] | null
        }
        Update: {
          address?: string | null
          address_detail?: string | null
          address_text?: never
          code?: string | null
          created_at?: string | null
          created_by?: string | null
          delivery_partner_count?: never
          department?: string | null
          driver_operation_type?:
            | Database["public"]["Enums"]["driver_operation_type"]
            | null
          email?: string | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          hire_date?: string | null
          id?: string | null
          is_active?: boolean | null
          is_delivery_driver?: boolean | null
          is_salary_paid?: boolean | null
          is_sales_rep?: boolean | null
          job_title?: string | null
          mobile?: string | null
          mobile2?: string | null
          name?: string | null
          note?: string | null
          partner_count?: never
          phone?: string | null
          postal_code?: string | null
          resignation_date?: string | null
          sales_partner_count?: never
          updated_at?: string | null
          updated_by?: string | null
          vehicle_number?: string | null
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"] | null
        }
        Relationships: []
      }
      partner_list_items: {
        Row: {
          address: string | null
          address_count: number | null
          address_detail: string | null
          business_category: string | null
          business_item: string | null
          business_number: string | null
          category_grandparent_id: string | null
          category_id: string | null
          category_is_active: boolean | null
          category_name: string | null
          category_parent_id: string | null
          category_path: string | null
          category_sort_key: number[] | null
          code: string | null
          company_name: string | null
          contact_count: number | null
          created_at: string | null
          created_by: string | null
          credit_limit: number | null
          credit_limit_type:
            | Database["public"]["Enums"]["credit_limit_type"]
            | null
          default_address: string | null
          default_address_detail: string | null
          default_address_id: string | null
          default_address_label: string | null
          default_address_postal_code: string | null
          default_address_text: string | null
          delivery_rep_code: string | null
          delivery_rep_has_duty: boolean | null
          delivery_rep_id: string | null
          delivery_rep_is_active: boolean | null
          delivery_rep_name: string | null
          id: string | null
          industry: Database["public"]["Enums"]["partner_industry"] | null
          invoice_type: Database["public"]["Enums"]["invoice_type"] | null
          is_active: boolean | null
          name: string | null
          note: string | null
          partner_type: Database["public"]["Enums"]["partner_type"] | null
          payment_day: number | null
          payment_term: Database["public"]["Enums"]["payment_term"] | null
          phone: string | null
          postal_code: string | null
          representative: string | null
          sales_rep_code: string | null
          sales_rep_has_duty: boolean | null
          sales_rep_id: string | null
          sales_rep_is_active: boolean | null
          sales_rep_name: string | null
          slip_print: Database["public"]["Enums"]["slip_print_type"] | null
          tax_email: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_categories_parent_id_fkey"
            columns: ["category_parent_id"]
            isOneToOne: false
            referencedRelation: "partner_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_categories_parent_id_fkey"
            columns: ["category_grandparent_id"]
            isOneToOne: false
            referencedRelation: "partner_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partners_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "partner_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partners_delivery_rep_id_fkey"
            columns: ["delivery_rep_id"]
            isOneToOne: false
            referencedRelation: "employee_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partners_delivery_rep_id_fkey"
            columns: ["delivery_rep_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partners_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "employee_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partners_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      product_list_items: {
        Row: {
          allergens: string[] | null
          barcode: string | null
          category_grandparent_id: string | null
          category_id: string | null
          category_parent_id: string | null
          code: string | null
          component_count: number | null
          created_at: string | null
          created_by: string | null
          effective_allergens: string[] | null
          effective_manufacturer: string | null
          effective_origin: string | null
          effective_shelf_life_days: number | null
          effective_storage_type:
            | Database["public"]["Enums"]["storage_type"]
            | null
          effective_tax_type: string | null
          id: string | null
          is_active: boolean | null
          manufacturer: string | null
          name: string | null
          note: string | null
          origin: string | null
          product_type: Database["public"]["Enums"]["product_type"] | null
          purchase_price_excl_vat: number | null
          purchase_price_incl_vat: number | null
          purchase_vat: number | null
          sale_price_excl_vat: number | null
          sale_price_incl_vat: number | null
          sale_vat: number | null
          shelf_life_days: number | null
          single_component_code: string | null
          single_component_id: string | null
          single_component_quantity: number | null
          spec: string | null
          storage_type: Database["public"]["Enums"]["storage_type"] | null
          tax_type: Database["public"]["Enums"]["tax_type"] | null
          unit: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["category_grandparent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["category_parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      create_bundle_product: {
        Args: { items: Json; product: Json }
        Returns: string
      }
      create_partner: {
        Args: { addresses: Json; contacts: Json; partner: Json }
        Returns: string
      }
      import_check_rows: {
        Args: { max_rows: number; rows: Json }
        Returns: undefined
      }
      import_employees: { Args: { rows: Json }; Returns: Json }
      import_error_field: {
        Args: { error_constraint: string; error_hint: string }
        Returns: string
      }
      import_find_employees: { Args: { codes: string[] }; Returns: Json }
      import_find_partners: {
        Args: { business_numbers: string[]; codes: string[] }
        Returns: Json
      }
      import_find_products: {
        Args: { barcodes: string[]; codes: string[] }
        Returns: Json
      }
      import_partner_category_id: {
        Args: { create_missing: boolean; path: Json }
        Returns: string
      }
      import_partners: {
        Args: { create_missing_categories?: boolean; rows: Json }
        Returns: Json
      }
      import_product_categories: { Args: { rows: Json }; Returns: Json }
      import_product_category_id: {
        Args: { create_missing: boolean; path: Json }
        Returns: string
      }
      import_products: {
        Args: {
          base_rows: Json
          bundle_rows: Json
          create_missing_categories?: boolean
        }
        Returns: Json
      }
      import_raise_row_error: {
        Args: {
          error_constraint: string
          error_hint: string
          error_message: string
          error_state: string
          excel_row: number
          field: string
          sheet: string
        }
        Returns: undefined
      }
      is_trimmed_text: {
        Args: { max_length: number; value: string }
        Returns: boolean
      }
      is_valid_business_number: { Args: { value: string }; Returns: boolean }
      is_valid_email: { Args: { value: string }; Returns: boolean }
      is_valid_phone: { Args: { value: string }; Returns: boolean }
      mixed_taxable_amount: {
        Args: {
          amount_incl: number
          taxable_weight: number
          total_weight: number
        }
        Returns: number
      }
      mixed_vat_excluded_amount: {
        Args: {
          amount_incl: number
          taxable_weight: number
          total_weight: number
        }
        Returns: number
      }
      partner_category_tree_version: { Args: never; Returns: string }
      save_partner_categories: {
        Args: { changes: Json; loaded_version: string }
        Returns: Json
      }
      save_partner_contacts_and_addresses: {
        Args: { addresses: Json; contacts: Json; target_partner_id: string }
        Returns: undefined
      }
      set_partner_category: {
        Args: { partner_ids: string[]; target_category_id?: string }
        Returns: number
      }
      suggest_employee_code: { Args: never; Returns: string }
      update_bundle_product: {
        Args: {
          items: Json
          loaded_updated_at: string
          product: Json
          product_id: string
        }
        Returns: string
      }
      update_partner: {
        Args: {
          addresses: Json
          contacts: Json
          loaded_updated_at: string
          partner: Json
          partner_id: string
        }
        Returns: string
      }
      vat_excluded_amount: {
        Args: { amount_incl: number; taxable: boolean }
        Returns: number
      }
    }
    Enums: {
      credit_limit_type: "none" | "limited" | "unlimited"
      driver_operation_type: "direct" | "consigned" | "chartered"
      employment_type: "regular" | "contract" | "daily" | "freelancer" | "other"
      invoice_type: "per_order" | "monthly" | "none"
      partner_industry:
        | "korean"
        | "chinese"
        | "japanese"
        | "western"
        | "snack"
        | "cafe_bakery"
        | "pub"
        | "catering"
        | "franchise"
        | "food_distribution"
        | "other"
      partner_type: "sales" | "purchase" | "both"
      payment_term: "per_order" | "monthly_day" | "month_end" | "unspecified"
      product_type: "base" | "bundle"
      slip_print_type: "with_amount" | "quantity_only"
      storage_type: "room" | "chilled" | "frozen"
      tax_type: "taxable" | "exempt"
      vehicle_type:
        | "refrigerated_truck"
        | "frozen_truck"
        | "box_truck"
        | "cargo_truck"
        | "small_van"
        | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      credit_limit_type: ["none", "limited", "unlimited"],
      driver_operation_type: ["direct", "consigned", "chartered"],
      employment_type: ["regular", "contract", "daily", "freelancer", "other"],
      invoice_type: ["per_order", "monthly", "none"],
      partner_industry: [
        "korean",
        "chinese",
        "japanese",
        "western",
        "snack",
        "cafe_bakery",
        "pub",
        "catering",
        "franchise",
        "food_distribution",
        "other",
      ],
      partner_type: ["sales", "purchase", "both"],
      payment_term: ["per_order", "monthly_day", "month_end", "unspecified"],
      product_type: ["base", "bundle"],
      slip_print_type: ["with_amount", "quantity_only"],
      storage_type: ["room", "chilled", "frozen"],
      tax_type: ["taxable", "exempt"],
      vehicle_type: [
        "refrigerated_truck",
        "frozen_truck",
        "box_truck",
        "cargo_truck",
        "small_van",
        "other",
      ],
    },
  },
} as const
