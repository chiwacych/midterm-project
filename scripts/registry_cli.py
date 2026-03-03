#!/usr/bin/env python3
"""
Federation Registry CLI
Command-line tool for interacting with the federation registry
"""

import requests
import json
import sys
from typing import Optional
import argparse
from tabulate import tabulate


class RegistryClient:
    """Client for federation registry API"""
    
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip('/')
        self.api_url = f"{self.base_url}/api/federation/registry"
    
    def self_register(self) -> dict:
        """Self-register this hospital"""
        url = f"{self.api_url}/self-register"
        response = requests.post(url)
        response.raise_for_status()
        return response.json()
    
    def discover_peers(self, hospital_id: str) -> dict:
        """Discover peer hospitals"""
        url = f"{self.api_url}/discover"
        response = requests.get(url, params={"hospital_id": hospital_id})
        response.raise_for_status()
        return response.json()
    
    def list_hospitals(self) -> dict:
        """List all hospitals in the registry"""
        url = f"{self.api_url}/list"
        response = requests.get(url)
        response.raise_for_status()
        return response.json()
    
    def get_hospital(self, hospital_id: str) -> dict:
        """Get detailed info about a specific hospital"""
        url = f"{self.api_url}/hospital/{hospital_id}"
        response = requests.get(url)
        response.raise_for_status()
        return response.json()


def cmd_register(args):
    """Self-register this hospital"""
    client = RegistryClient(args.url)
    
    print("📝 Registering hospital...")
    result = client.self_register()
    
    if result.get('success'):
        print(f"✅ Successfully registered: {result['hospital_id']}")
        print(f"   Federation endpoint: {result['federation_endpoint']}")
        print(f"   Discovered {result['peer_count']} peer(s)")
        
        if result.get('peers'):
            print("\n🔍 Discovered Peers:")
            for peer in result['peers']:
                print(f"   • {peer['name']} ({peer['id']}) at {peer['endpoint']}")
    else:
        print(f"❌ Registration failed: {result.get('message')}")
        sys.exit(1)


def cmd_discover(args):
    """Discover peer hospitals"""
    client = RegistryClient(args.url)
    
    print(f"🔍 Discovering peers for {args.hospital_id}...")
    result = client.discover_peers(args.hospital_id)
    
    if result.get('success'):
        peers = result.get('peers', [])
        print(f"\n✅ Found {result['total_peers']} peer(s):\n")
        
        if peers:
            # Format as table
            table_data = []
            for peer in peers:
                table_data.append([
                    peer['hospital_id'],
                    peer['hospital_name'],
                    peer['federation_endpoint'],
                    peer['status'],
                    peer.get('capabilities', {}).get('file_sharing', 'N/A')
                ])
            
            headers = ['ID', 'Name', 'Endpoint', 'Status', 'File Sharing']
            print(tabulate(table_data, headers=headers, tablefmt='grid'))
            
            # Show certificate info
            if args.verbose:
                print("\n📜 Certificate Information:")
                for peer in peers:
                    print(f"\n{peer['hospital_name']}:")
                    print(f"  Fingerprint: {peer['certificate_fingerprint'][:32]}...")
                    print(f"  Valid: {peer['certificate_not_before']} to {peer['certificate_not_after']}")
        else:
            print("No peers found. This hospital is alone in the network.")
    else:
        print("❌ Discovery failed")
        sys.exit(1)


def cmd_list(args):
    """List all hospitals"""
    client = RegistryClient(args.url)
    
    print("📋 Listing all hospitals in federation...\n")
    result = client.list_hospitals()
    
    if result.get('success'):
        hospitals = result.get('hospitals', [])
        print(f"Total: {result['total_hospitals']} hospital(s)\n")
        
        if hospitals:
            table_data = []
            for hospital in hospitals:
                table_data.append([
                    hospital['hospital_id'],
                    hospital['hospital_name'],
                    hospital['federation_endpoint'],
                    hospital['status'],
                    hospital['registered_at'][:19]  # Trim milliseconds
                ])
            
            headers = ['ID', 'Name', 'Endpoint', 'Status', 'Registered']
            print(tabulate(table_data, headers=headers, tablefmt='grid'))
        else:
            print("No hospitals in registry.")
    else:
        print("❌ Failed to list hospitals")
        sys.exit(1)


def cmd_info(args):
    """Get detailed hospital info"""
    client = RegistryClient(args.url)
    
    print(f"📄 Getting info for {args.hospital_id}...\n")
    
    try:
        hospital = client.get_hospital(args.hospital_id)
        
        print(f"{'=' * 60}")
        print(f"Hospital: {hospital['hospital_name']}")
        print(f"{'=' * 60}")
        print(f"\n🏥 Identity:")
        print(f"   ID:           {hospital['hospital_id']}")
        print(f"   Organization: {hospital['organization']}")
        print(f"   Contact:      {hospital['contact_email']}")
        
        print(f"\n🌐 Network:")
        print(f"   Federation:   {hospital['federation_endpoint']}")
        print(f"   API:          {hospital['api_endpoint']}")
        print(f"   Region:       {hospital.get('country', 'N/A')}")
        
        print(f"\n📜 Certificate:")
        print(f"   Fingerprint:  {hospital['certificate_fingerprint']}")
        print(f"   CA:           {hospital['ca_fingerprint'][:32]}...")
        print(f"   Valid From:   {hospital['certificate_not_before']}")
        print(f"   Valid To:     {hospital['certificate_not_after']}")
        
        caps = hospital.get('capabilities', {})
        print(f"\n⚙️  Capabilities:")
        print(f"   File Sharing:     {caps.get('file_sharing', False)}")
        print(f"   Patient Records:  {caps.get('patient_records', False)}")
        print(f"   DICOM Imaging:    {caps.get('dicom_imaging', False)}")
        print(f"   Max File Size:    {caps.get('max_file_size_mb', 0)} MB")
        
        print(f"\n📊 Status:")
        print(f"   Status:       {hospital['status']}")
        print(f"   Registered:   {hospital['registration_timestamp']}")
        print(f"   Version:      {hospital['version']}")
        
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            print(f"❌ Hospital '{args.hospital_id}' not found")
        else:
            print(f"❌ Error: {e}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description='Federation Registry CLI',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Register this hospital
  python registry_cli.py register

  # Discover peers
  python registry_cli.py discover hospital-a

  # List all hospitals
  python registry_cli.py list

  # Get detailed info
  python registry_cli.py info hospital-b
        """
    )
    
    parser.add_argument(
        '--url',
        default='http://localhost:8000',
        help='Base URL of the hospital API (default: http://localhost:8000)'
    )
    
    subparsers = parser.add_subparsers(dest='command', help='Command to run')
    
    # Register command
    register_parser = subparsers.add_parser('register', help='Self-register this hospital')
    register_parser.set_defaults(func=cmd_register)
    
    # Discover command
    discover_parser = subparsers.add_parser('discover', help='Discover peer hospitals')
    discover_parser.add_argument('hospital_id', help='Your hospital ID')
    discover_parser.add_argument('-v', '--verbose', action='store_true', help='Show detailed info')
    discover_parser.set_defaults(func=cmd_discover)
    
    # List command
    list_parser = subparsers.add_parser('list', help='List all hospitals')
    list_parser.set_defaults(func=cmd_list)
    
    # Info command
    info_parser = subparsers.add_parser('info', help='Get detailed hospital info')
    info_parser.add_argument('hospital_id', help='Hospital ID to query')
    info_parser.set_defaults(func=cmd_info)
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        sys.exit(1)
    
    try:
        args.func(args)
    except requests.exceptions.ConnectionError:
        print(f"❌ Failed to connect to {args.url}")
        print("   Make sure the hospital API is running.")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
