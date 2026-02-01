"""
Database Migration Script for DPA-Compliant Patient-Centered Architecture

This script adds the following changes:
1. Creates patients table with DPA-compliant identifier hashes
2. Creates access_requests table
3. Adds patient_id foreign key to file_metadata
4. Adds patient_id to consents table
5. Adds DICOM-specific fields to file_metadata

Run this script AFTER backing up your database!

Usage:
  # From host (with correct connection string):
  python migrate_to_patient_centered.py "postgresql://dfsuser:dfspass@localhost:5432/dfs_metadata"
  
  # From within Docker container:
  docker-compose exec fastapi python /app/scripts/migrate_to_patient_centered.py
"""

import sys
import os
from sqlalchemy import create_engine, text

# Try to import from app if available (when run from Docker)
try:
    sys.path.insert(0, '/app')
    from database import DATABASE_URL as DEFAULT_DB_URL
    from models import Base
except ImportError:
    # Running from host, use default or provided URL
    DEFAULT_DB_URL = "postgresql://dfsuser:dfspass@localhost:5432/dfs_metadata"
    # Import models directly
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'app'))
    try:
        from models import Base
    except ImportError:
        print("❌ Could not import models. Make sure you're in the correct directory.")
        Base = None

def migrate_database():
    """Run database migrations for patient-centered architecture."""
    # Get database URL from command line or use default
    if len(sys.argv) > 1:
        database_url = sys.argv[1]
    else:
        database_url = DEFAULT_DB_URL
    
    print(f"🔗 Connecting to: {database_url.replace(database_url.split('@')[0].split('//')[1], '***')}")
    
    engine = create_engine(database_url)
    
    print("🔄 Starting database migration...")
    
    # Create all new tables
    print("📊 Creating new tables (patients, access_requests)...")
    if Base:
        Base.metadata.create_all(bind=engine)
    else:
        print("⚠️  Base not available, manually creating tables...")
    
    # Add new columns to existing tables
    print("🔧 Adding new columns to existing tables...")
    
    with engine.connect() as conn:
        try:
            # Add patient_id to file_metadata
            print("  - Adding patient_id to file_metadata...")
            conn.execute(text("""
                ALTER TABLE file_metadata 
                ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patients(id);
            """))
            
            # Add DICOM fields to file_metadata
            print("  - Adding DICOM fields to file_metadata...")
            conn.execute(text("""
                ALTER TABLE file_metadata 
                ADD COLUMN IF NOT EXISTS dicom_study_id VARCHAR(100),
                ADD COLUMN IF NOT EXISTS dicom_series_id VARCHAR(100),
                ADD COLUMN IF NOT EXISTS dicom_modality VARCHAR(50),
                ADD COLUMN IF NOT EXISTS dicom_study_date DATE;
            """))
            
            # Create indexes for DICOM fields
            print("  - Creating indexes for DICOM fields...")
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_file_metadata_dicom_study 
                ON file_metadata(dicom_study_id);
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_file_metadata_dicom_series 
                ON file_metadata(dicom_series_id);
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_file_metadata_patient 
                ON file_metadata(patient_id);
            """))
            
            # Add patient_id to consents
            print("  - Adding patient_id to consents...")
            conn.execute(text("""
                ALTER TABLE consents 
                ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patients(id);
            """))
            
            # Create index for patient_id in consents
            print("  - Creating index for patient_id in consents...")
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_consents_patient 
                ON consents(patient_id);
            """))
            
            conn.commit()
            print("✅ Migration completed successfully!")
            print()
            print("⚠️  IMPORTANT: All file uploads now require a patient_id.")
            print("   You may need to:")
            print("   1. Create patient records for existing users")
            print("   2. Update existing files to link to patients")
            print("   3. Update your frontend upload forms to include patient selection")
            
        except Exception as e:
            print(f"❌ Migration failed: {e}")
            conn.rollback()
            raise

if __name__ == "__main__":
    import sys
    
    print("=" * 60)
    print("DPA-COMPLIANT PATIENT-CENTERED MIGRATION")
    print("=" * 60)
    print()
    
    # Check if running in non-interactive mode (from Docker)
    if '--yes' in sys.argv or '-y' in sys.argv:
        try:
            migrate_database()
        except Exception as e:
            print(f"\n❌ Migration failed: {e}")
            sys.exit(1)
    else:
        print("⚠️  WARNING: This will modify your database schema!")
        print("   Make sure you have a backup before proceeding.")
        print()
        print("Usage:")
        print("  From Docker: docker-compose exec fastapi python scripts/migrate_to_patient_centered.py --yes")
        print("  From host:   python migrate_to_patient_centered.py 'postgresql://dfsuser:dfspass@localhost:5432/dfs_metadata' --yes")
        print()
        
        response = input("Do you want to continue? (yes/no): ")
        
        if response.lower() in ['yes', 'y']:
            try:
                migrate_database()
            except Exception as e:
                print(f"\n❌ Migration failed: {e}")
                sys.exit(1)
        else:
            print("❌ Migration cancelled.")
            sys.exit(0)
