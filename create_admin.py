from passlib.context import CryptContext
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

pwd_context = CryptContext(schemes=['argon2', 'bcrypt'], deprecated='auto')
hash_pwd = pwd_context.hash('admin')

engine = create_engine('postgresql://dfsuser:dfspass@postgres-primary:5432/dfs_metadata')
Session = sessionmaker(bind=engine)
session = Session()

query = text("""
    INSERT INTO users (email, hashed_password, full_name, role, is_active, created_at)
    VALUES (:email, :pwd, :name, :role, true, NOW())
""")

session.execute(query, {
    'email': 'admin@example.com',
    'pwd': hash_pwd,
    'name': 'Admin User',
    'role': 'admin'
})
session.commit()
session.close()

print('Admin user created successfully')
print(f'Email: admin@example.com')
print(f'Password: admin')
print(f'Hash: {hash_pwd}')
