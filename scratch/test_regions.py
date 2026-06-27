import sqlalchemy

regions = [
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 
    'ca-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 
    'eu-central-1', 'eu-north-1', 'ap-south-1', 'ap-southeast-1', 
    'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2', 'sa-east-1'
]

print("Scanning regions...")
for r in regions:
    url = f"postgresql://postgres.fdeoxtmjfhlsijqltytm:CbRoXymbtTQu8B7k@aws-0-{r}.pooler.supabase.com:6543/postgres"
    try:
        engine = sqlalchemy.create_engine(url, connect_args={'connect_timeout': 3})
        conn = engine.connect()
        print(f"SUCCESS: Connected to region {r}!")
        conn.close()
        break
    except Exception as e:
        if "tenant/user" not in str(e):
            print(f"Region {r} failed with: {str(e)[:100]}")
        else:
            # tenant not found means the pooler is active in this region but this tenant is not there
            pass
print("Scan completed.")
