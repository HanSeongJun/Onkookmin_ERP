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
      app_settings: {
        Row: {
          created_at: string
          created_by: string | null
          expiry_warning_days: number
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expiry_warning_days?: number
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expiry_warning_days?: number
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
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
            referencedRelation: "product_stock_summary"
            referencedColumns: ["product_id"]
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
            referencedRelation: "product_stock_summary"
            referencedColumns: ["product_id"]
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
      stock_balances: {
        Row: {
          created_at: string
          id: string
          location_id: string
          lot_id: string
          product_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          lot_id: string
          product_id: string
          quantity: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          lot_id?: string
          product_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_location_items"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "stock_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "stock_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_documents: {
        Row: {
          created_at: string
          created_by: string | null
          doc_date: string
          doc_no: string
          doc_type: Database["public"]["Enums"]["stock_document_type"]
          id: string
          memo: string | null
          partner_id: string | null
          request_id: string | null
          reversed_at: string | null
          reversed_by_id: string | null
          reverses_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doc_date: string
          doc_no: string
          doc_type: Database["public"]["Enums"]["stock_document_type"]
          id?: string
          memo?: string | null
          partner_id?: string | null
          request_id?: string | null
          reversed_at?: string | null
          reversed_by_id?: string | null
          reverses_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doc_date?: string
          doc_no?: string
          doc_type?: Database["public"]["Enums"]["stock_document_type"]
          id?: string
          memo?: string | null
          partner_id?: string | null
          request_id?: string | null
          reversed_at?: string | null
          reversed_by_id?: string | null
          reverses_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_documents_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partner_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_reversed_by_id_fkey"
            columns: ["reversed_by_id"]
            isOneToOne: true
            referencedRelation: "stock_document_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_reversed_by_id_fkey"
            columns: ["reversed_by_id"]
            isOneToOne: true
            referencedRelation: "stock_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_reverses_id_fkey"
            columns: ["reverses_id"]
            isOneToOne: true
            referencedRelation: "stock_document_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_reverses_id_fkey"
            columns: ["reverses_id"]
            isOneToOne: true
            referencedRelation: "stock_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_lots: {
        Row: {
          created_at: string
          created_by: string | null
          created_document_id: string
          expiry_date: string | null
          expiry_kind: Database["public"]["Enums"]["expiry_kind"]
          id: string
          lot_no: string
          manufactured_date: string | null
          memo: string | null
          origin: string | null
          product_id: string
          received_date: string
          supplier_id: string | null
          supplier_lot_no: string | null
          unit_cost_incl_vat: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_document_id: string
          expiry_date?: string | null
          expiry_kind: Database["public"]["Enums"]["expiry_kind"]
          id?: string
          lot_no: string
          manufactured_date?: string | null
          memo?: string | null
          origin?: string | null
          product_id: string
          received_date: string
          supplier_id?: string | null
          supplier_lot_no?: string | null
          unit_cost_incl_vat?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_document_id?: string
          expiry_date?: string | null
          expiry_kind?: Database["public"]["Enums"]["expiry_kind"]
          id?: string
          lot_no?: string
          manufactured_date?: string | null
          memo?: string | null
          origin?: string | null
          product_id?: string
          received_date?: string
          supplier_id?: string | null
          supplier_lot_no?: string | null
          unit_cost_incl_vat?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_lots_created_document_id_fkey"
            columns: ["created_document_id"]
            isOneToOne: false
            referencedRelation: "stock_document_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_created_document_id_fkey"
            columns: ["created_document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "partner_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          bundle_id: string | null
          bundle_quantity: number | null
          bundle_unit_cost_incl_vat: number | null
          created_at: string
          doc_date: string
          document_id: string
          id: string
          is_reversal: boolean
          line_no: number
          location_id: string
          lot_id: string
          memo: string | null
          movement_type: Database["public"]["Enums"]["stock_document_type"]
          product_id: string
          quantity_delta: number
          reason: Database["public"]["Enums"]["disposal_reason"] | null
          reverses_movement_id: string | null
          seq: number
          unit_cost_incl_vat: number | null
        }
        Insert: {
          bundle_id?: string | null
          bundle_quantity?: number | null
          bundle_unit_cost_incl_vat?: number | null
          created_at?: string
          doc_date: string
          document_id: string
          id?: string
          is_reversal?: boolean
          line_no: number
          location_id: string
          lot_id: string
          memo?: string | null
          movement_type: Database["public"]["Enums"]["stock_document_type"]
          product_id: string
          quantity_delta: number
          reason?: Database["public"]["Enums"]["disposal_reason"] | null
          reverses_movement_id?: string | null
          seq?: never
          unit_cost_incl_vat?: number | null
        }
        Update: {
          bundle_id?: string | null
          bundle_quantity?: number | null
          bundle_unit_cost_incl_vat?: number | null
          created_at?: string
          doc_date?: string
          document_id?: string
          id?: string
          is_reversal?: boolean
          line_no?: number
          location_id?: string
          lot_id?: string
          memo?: string | null
          movement_type?: Database["public"]["Enums"]["stock_document_type"]
          product_id?: string
          quantity_delta?: number
          reason?: Database["public"]["Enums"]["disposal_reason"] | null
          reverses_movement_id?: string | null
          seq?: never
          unit_cost_incl_vat?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "product_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "product_stock_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "stock_document_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_location_items"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "stock_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_reverses_movement_id_fkey"
            columns: ["reverses_movement_id"]
            isOneToOne: true
            referencedRelation: "stock_movement_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_reverses_movement_id_fkey"
            columns: ["reverses_movement_id"]
            isOneToOne: true
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_number_counters: {
        Row: {
          created_at: string
          id: string
          last_number: number
          scope: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_number: number
          scope: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_number?: number
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      storage_locations: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
          zone_id: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          zone_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_locations_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "lot_stock_items"
            referencedColumns: ["zone_id"]
          },
          {
            foreignKeyName: "storage_locations_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "stock_movement_items"
            referencedColumns: ["zone_id"]
          },
          {
            foreignKeyName: "storage_locations_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "storage_location_items"
            referencedColumns: ["zone_id"]
          },
          {
            foreignKeyName: "storage_locations_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "warehouse_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_zones: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          note: string | null
          sort_order: number
          storage_type: Database["public"]["Enums"]["storage_type"]
          updated_at: string
          updated_by: string | null
          warehouse_id: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          note?: string | null
          sort_order?: number
          storage_type: Database["public"]["Enums"]["storage_type"]
          updated_at?: string
          updated_by?: string | null
          warehouse_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          note?: string | null
          sort_order?: number
          storage_type?: Database["public"]["Enums"]["storage_type"]
          updated_at?: string
          updated_by?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_zones_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "lot_stock_items"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "warehouse_zones_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "stock_movement_items"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "warehouse_zones_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "storage_location_items"
            referencedColumns: ["warehouse_id"]
          },
          {
            foreignKeyName: "warehouse_zones_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          address: string | null
          address_detail: string | null
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          note: string | null
          postal_code: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          address_detail?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          note?: string | null
          postal_code?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          address_detail?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          note?: string | null
          postal_code?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
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
      lot_stock_items: {
        Row: {
          balance_id: string | null
          balance_updated_at: string | null
          category_grandparent_id: string | null
          category_id: string | null
          category_parent_id: string | null
          cost_estimated: boolean | null
          created_document_id: string | null
          days_left: number | null
          effective_unit_cost_incl_vat: number | null
          expiry_date: string | null
          expiry_kind: Database["public"]["Enums"]["expiry_kind"] | null
          expiry_status: string | null
          location_code: string | null
          location_id: string | null
          location_is_active: boolean | null
          location_is_default: boolean | null
          location_name: string | null
          location_sort_order: number | null
          lot_id: string | null
          lot_memo: string | null
          lot_no: string | null
          lot_origin: string | null
          manufactured_date: string | null
          product_barcode: string | null
          product_code: string | null
          product_id: string | null
          product_is_active: boolean | null
          product_name: string | null
          product_origin: string | null
          product_purchase_price_incl_vat: number | null
          product_spec: string | null
          product_storage_type:
            | Database["public"]["Enums"]["storage_type"]
            | null
          product_tax_type: Database["public"]["Enums"]["tax_type"] | null
          product_unit: string | null
          quantity: number | null
          received_date: string | null
          storage_mismatch: boolean | null
          storage_too_warm: boolean | null
          supplier_code: string | null
          supplier_id: string | null
          supplier_lot_no: string | null
          supplier_name: string | null
          unit_cost_incl_vat: number | null
          value_excl_vat: number | null
          value_incl_vat: number | null
          warehouse_code: string | null
          warehouse_id: string | null
          warehouse_is_active: boolean | null
          warehouse_name: string | null
          warehouse_sort_order: number | null
          zone_code: string | null
          zone_id: string | null
          zone_is_active: boolean | null
          zone_name: string | null
          zone_sort_order: number | null
          zone_storage_type: Database["public"]["Enums"]["storage_type"] | null
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
          {
            foreignKeyName: "stock_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_location_items"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "stock_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "stock_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_created_document_id_fkey"
            columns: ["created_document_id"]
            isOneToOne: false
            referencedRelation: "stock_document_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_created_document_id_fkey"
            columns: ["created_document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_lots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "partner_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
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
            columns: ["category_grandparent_id"]
            isOneToOne: false
            referencedRelation: "partner_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_categories_parent_id_fkey"
            columns: ["category_parent_id"]
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
      product_stock_summary: {
        Row: {
          available_quantity: number | null
          category_grandparent_id: string | null
          category_id: string | null
          category_parent_id: string | null
          cost_estimated: boolean | null
          cost_missing: boolean | null
          expired_quantity: number | null
          imminent_quantity: number | null
          location_count: number | null
          lot_count: number | null
          mismatch_count: number | null
          nearest_expiry_date: string | null
          nearest_expiry_kind: Database["public"]["Enums"]["expiry_kind"] | null
          on_hand_quantity: number | null
          product_barcode: string | null
          product_code: string | null
          product_id: string | null
          product_is_active: boolean | null
          product_name: string | null
          product_purchase_price_incl_vat: number | null
          product_shelf_life_days: number | null
          product_spec: string | null
          product_storage_type:
            | Database["public"]["Enums"]["storage_type"]
            | null
          product_tax_type: Database["public"]["Enums"]["tax_type"] | null
          product_unit: string | null
          value_excl_vat: number | null
          value_incl_vat: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["category_parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["category_grandparent_id"]
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
      stock_document_list_items: {
        Row: {
          cost_unknown: boolean | null
          created_at: string | null
          created_by: string | null
          doc_date: string | null
          doc_no: string | null
          doc_type: Database["public"]["Enums"]["stock_document_type"] | null
          effective_type:
            | Database["public"]["Enums"]["stock_document_type"]
            | null
          first_product_code: string | null
          first_product_id: string | null
          first_product_name: string | null
          first_product_unit: string | null
          id: string | null
          line_count: number | null
          memo: string | null
          movement_count: number | null
          partner_code: string | null
          partner_id: string | null
          partner_name: string | null
          partner_type: Database["public"]["Enums"]["partner_type"] | null
          product_count: number | null
          product_ids: string[] | null
          request_id: string | null
          reversed_at: string | null
          reversed_by_doc_date: string | null
          reversed_by_doc_no: string | null
          reversed_by_id: string | null
          reverses_doc_date: string | null
          reverses_doc_no: string | null
          reverses_id: string | null
          search_text: string | null
          updated_at: string | null
          value_in_incl_vat: number | null
          value_out_incl_vat: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_documents_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partner_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_reversed_by_id_fkey"
            columns: ["reversed_by_id"]
            isOneToOne: true
            referencedRelation: "stock_document_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_reversed_by_id_fkey"
            columns: ["reversed_by_id"]
            isOneToOne: true
            referencedRelation: "stock_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_reverses_id_fkey"
            columns: ["reverses_id"]
            isOneToOne: true
            referencedRelation: "stock_document_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_reverses_id_fkey"
            columns: ["reverses_id"]
            isOneToOne: true
            referencedRelation: "stock_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movement_items: {
        Row: {
          amount_excl_vat: number | null
          amount_incl_vat: number | null
          bundle_code: string | null
          bundle_id: string | null
          bundle_name: string | null
          bundle_quantity: number | null
          bundle_unit: string | null
          bundle_unit_cost_incl_vat: number | null
          created_at: string | null
          doc_date: string | null
          doc_no: string | null
          doc_type: Database["public"]["Enums"]["stock_document_type"] | null
          document_id: string | null
          expiry_date: string | null
          expiry_kind: Database["public"]["Enums"]["expiry_kind"] | null
          id: string | null
          is_reversal: boolean | null
          line_no: number | null
          location_code: string | null
          location_id: string | null
          location_name: string | null
          lot_id: string | null
          lot_no: string | null
          manufactured_date: string | null
          memo: string | null
          movement_type:
            | Database["public"]["Enums"]["stock_document_type"]
            | null
          partner_code: string | null
          partner_id: string | null
          partner_name: string | null
          product_code: string | null
          product_id: string | null
          product_name: string | null
          product_spec: string | null
          product_storage_type:
            | Database["public"]["Enums"]["storage_type"]
            | null
          product_tax_type: Database["public"]["Enums"]["tax_type"] | null
          product_unit: string | null
          quantity_delta: number | null
          reason: Database["public"]["Enums"]["disposal_reason"] | null
          received_date: string | null
          reverses_movement_id: string | null
          seq: number | null
          supplier_lot_no: string | null
          unit_cost_incl_vat: number | null
          warehouse_code: string | null
          warehouse_id: string | null
          warehouse_name: string | null
          zone_code: string | null
          zone_id: string | null
          zone_name: string | null
          zone_storage_type: Database["public"]["Enums"]["storage_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_documents_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partner_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "product_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "product_stock_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "stock_document_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_location_items"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "stock_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_list_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_stock_summary"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_reverses_movement_id_fkey"
            columns: ["reverses_movement_id"]
            isOneToOne: true
            referencedRelation: "stock_movement_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_reverses_movement_id_fkey"
            columns: ["reverses_movement_id"]
            isOneToOne: true
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_location_items: {
        Row: {
          can_receive: boolean | null
          is_used: boolean | null
          location_code: string | null
          location_id: string | null
          location_is_active: boolean | null
          location_is_default: boolean | null
          location_name: string | null
          location_sort_order: number | null
          location_updated_at: string | null
          stock_quantity_total: number | null
          stock_row_count: number | null
          warehouse_code: string | null
          warehouse_id: string | null
          warehouse_is_active: boolean | null
          warehouse_name: string | null
          warehouse_sort_order: number | null
          zone_code: string | null
          zone_id: string | null
          zone_is_active: boolean | null
          zone_name: string | null
          zone_sort_order: number | null
          zone_storage_type: Database["public"]["Enums"]["storage_type"] | null
        }
        Relationships: []
      }
    }
    Functions: {
      allocate_fefo: {
        Args: {
          filter_location_id?: string
          filter_warehouse_id?: string
          filter_zone_id?: string
          include_expired?: boolean
          plan_date?: string
          target_product_id: string
          target_quantity: number
        }
        Returns: Json
      }
      apply_stock_count: {
        Args: { header: Json; lines: Json; new_lots?: Json }
        Returns: Json
      }
      check_stock_header: { Args: { header: Json }; Returns: undefined }
      check_stock_input_location: {
        Args: {
          field: string
          line_no: number
          list?: string
          target_location_id: string
        }
        Returns: Database["public"]["Enums"]["storage_type"]
      }
      check_stock_lines: {
        Args: { allow_empty: boolean; lines: Json; list?: string }
        Returns: undefined
      }
      check_stock_pair_history: {
        Args: {
          line_no: number
          list?: string
          target_location_id: string
          target_lot_id: string
        }
        Returns: undefined
      }
      check_stock_partner: {
        Args: { supplier_only: boolean; target_partner_id: string }
        Returns: undefined
      }
      create_bundle_product: {
        Args: { items: Json; product: Json }
        Returns: string
      }
      create_partner: {
        Args: { addresses: Json; contacts: Json; partner: Json }
        Returns: string
      }
      create_stock_document: {
        Args: {
          document_date: string
          document_memo: string
          document_partner_id: string
          document_type: Database["public"]["Enums"]["stock_document_type"]
          header: Json
          reversed_document_id: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          doc_date: string
          doc_no: string
          doc_type: Database["public"]["Enums"]["stock_document_type"]
          id: string
          memo: string | null
          partner_id: string | null
          request_id: string | null
          reversed_at: string | null
          reversed_by_id: string | null
          reverses_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "stock_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_stock_lot: {
        Args: {
          line_no: number
          list: string
          lot_document: Database["public"]["Tables"]["stock_documents"]["Row"]
          lot_expiry_date: string
          lot_expiry_kind: Database["public"]["Enums"]["expiry_kind"]
          lot_manufactured_date: string
          lot_memo: string
          lot_origin: string
          lot_product_id: string
          lot_received_date: string
          lot_supplier_id: string
          lot_supplier_lot_no: string
          lot_unit_cost: number
          typed_lot_no: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          created_document_id: string
          expiry_date: string | null
          expiry_kind: Database["public"]["Enums"]["expiry_kind"]
          id: string
          lot_no: string
          manufactured_date: string | null
          memo: string | null
          origin: string | null
          product_id: string
          received_date: string
          supplier_id: string | null
          supplier_lot_no: string | null
          unit_cost_incl_vat: number | null
        }
        SetofOptions: {
          from: "*"
          to: "stock_lots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dispose_stock: { Args: { header: Json; lines: Json }; Returns: Json }
      find_stock_request: { Args: { header: Json }; Returns: Json }
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
      import_find_opening_stock_refs: {
        Args: {
          lot_nos: string[]
          product_codes: string[]
          supplier_codes: string[]
        }
        Returns: Json
      }
      import_find_partners: {
        Args: { business_numbers: string[]; codes: string[] }
        Returns: Json
      }
      import_find_products: {
        Args: { barcodes: string[]; codes: string[] }
        Returns: Json
      }
      import_opening_stock: {
        Args: { opening_date?: string; request_id?: string; rows: Json }
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
      is_stock_place_code: {
        Args: { max_length: number; value: string }
        Returns: boolean
      }
      is_trimmed_text: {
        Args: { max_length: number; value: string }
        Returns: boolean
      }
      is_valid_business_number: { Args: { value: string }; Returns: boolean }
      is_valid_email: { Args: { value: string }; Returns: boolean }
      is_valid_phone: { Args: { value: string }; Returns: boolean }
      issue_stock: { Args: { header: Json; lines: Json }; Returns: Json }
      lock_stock_lots: { Args: { lot_ids: string[] }; Returns: undefined }
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
      next_stock_number: { Args: { counter_scope: string }; Returns: number }
      partner_category_tree_version: { Args: never; Returns: string }
      plan_stock_issue: {
        Args: { include_expired?: boolean; lines: Json; plan_date?: string }
        Returns: Json
      }
      product_stock_ledger: {
        Args: {
          date_from: string
          date_to: string
          filter_location_id?: string
          filter_warehouse_id?: string
          filter_zone_id?: string
          target_product_id: string
        }
        Returns: Json
      }
      raise_stock_error: {
        Args: {
          extra?: Json
          field?: string
          line_no?: number
          message: string
          rule: string
          state?: string
        }
        Returns: undefined
      }
      read_stock_amount: {
        Args: {
          field: string
          label: string
          line_no: number
          list?: string
          value: Json
        }
        Returns: number
      }
      read_stock_date: {
        Args: {
          field: string
          label: string
          line_no: number
          list?: string
          value: Json
        }
        Returns: string
      }
      read_stock_doc_date: { Args: { value: Json }; Returns: string }
      read_stock_quantity: {
        Args: {
          allow_zero: boolean
          field: string
          label: string
          line_no: number
          list?: string
          value: Json
          whole_only: boolean
        }
        Returns: number
      }
      read_stock_text: {
        Args: {
          field: string
          label: string
          line_no: number
          list?: string
          max_length: number
          value: Json
        }
        Returns: string
      }
      read_stock_uuid: {
        Args: {
          field: string
          label: string
          line_no: number
          list?: string
          required: boolean
          value: Json
        }
        Returns: string
      }
      receive_stock: { Args: { header: Json; lines: Json }; Returns: Json }
      reverse_stock_document: {
        Args: { header?: Json; target_document_id: string }
        Returns: Json
      }
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
      stock_available_from: {
        Args: {
          from_date: string
          target_location_id: string
          target_lot_id: string
        }
        Returns: number
      }
      stock_balance_as_of: {
        Args: {
          as_of: string
          target_location_id: string
          target_lot_id: string
        }
        Returns: number
      }
      stock_bundle_components: {
        Args: {
          target_product_id: string
          target_quantity?: number
          target_unit_cost?: number
        }
        Returns: Json
      }
      stock_count_sheet: {
        Args: {
          as_of?: string
          filter_location_id?: string
          filter_warehouse_id: string
          filter_zone_id?: string
        }
        Returns: Json
      }
      stock_dashboard: { Args: { recent_limit?: number }; Returns: Json }
      stock_expiry_from_manufactured: {
        Args: { manufactured: string; shelf_life_days: number }
        Returns: string
      }
      stock_integrity_check: {
        Args: never
        Returns: {
          detail: Json
          problem: string
        }[]
      }
      stock_issue_plan: {
        Args: {
          include_expired?: boolean
          lines: Json
          only_lot_ids?: string[]
          plan_date?: string
        }
        Returns: Json
      }
      stock_location_info: {
        Args: { target_location_id: string }
        Returns: {
          can_receive: boolean
          label: string
          location_code: string
          location_id: string
          location_is_active: boolean
          location_name: string
          warehouse_code: string
          warehouse_id: string
          warehouse_is_active: boolean
          warehouse_name: string
          zone_code: string
          zone_id: string
          zone_is_active: boolean
          zone_name: string
          zone_storage_type: Database["public"]["Enums"]["storage_type"]
        }[]
      }
      stock_number_text: { Args: { sequence_number: number }; Returns: string }
      stock_period_report: {
        Args: {
          date_from: string
          date_to: string
          filter_category_id?: string
          filter_location_id?: string
          filter_storage_type?: string
          filter_tax_type?: string
          filter_warehouse_id?: string
          filter_zone_id?: string
          only_uncategorized?: boolean
          only_with_stock?: boolean
          product_status?: string
          search_text?: string
        }
        Returns: Json
      }
      stock_quantity_text: { Args: { quantity: number }; Returns: string }
      stock_receive_line: {
        Args: {
          allow_bundle: boolean
          line: Json
          line_no: number
          list: string
          lot_received_date: string
          lot_supplier_id: string
          movement_line_no: number
          target_document: Database["public"]["Tables"]["stock_documents"]["Row"]
        }
        Returns: Json
      }
      stock_today: { Args: never; Returns: string }
      stock_transfer_warnings: { Args: { lines: Json }; Returns: Json }
      suggest_employee_code: { Args: never; Returns: string }
      transfer_stock: { Args: { header: Json; lines: Json }; Returns: Json }
      unit_allows_fraction: { Args: { unit: string }; Returns: boolean }
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
      disposal_reason: "expired" | "damaged" | "quality" | "other"
      driver_operation_type: "direct" | "consigned" | "chartered"
      employment_type: "regular" | "contract" | "daily" | "freelancer" | "other"
      expiry_kind: "use_by" | "sell_by" | "none"
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
      stock_document_type:
        | "opening"
        | "receipt"
        | "issue"
        | "disposal"
        | "transfer"
        | "count"
        | "reversal"
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
      disposal_reason: ["expired", "damaged", "quality", "other"],
      driver_operation_type: ["direct", "consigned", "chartered"],
      employment_type: ["regular", "contract", "daily", "freelancer", "other"],
      expiry_kind: ["use_by", "sell_by", "none"],
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
      stock_document_type: [
        "opening",
        "receipt",
        "issue",
        "disposal",
        "transfer",
        "count",
        "reversal",
      ],
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
